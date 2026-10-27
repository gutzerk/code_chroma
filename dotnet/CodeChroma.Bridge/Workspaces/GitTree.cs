using System.Diagnostics;
using System.Text;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Workspaces;

/// <summary>Raised when git itself refuses an accept in a way no caller can fix (HTTP 500).</summary>
public class GitCommandException(string message) : Exception(message);

/// <summary>The patch could not be applied, most likely because the file changed since diffing (HTTP 409).</summary>
public sealed class GitConflictException(string message) : GitCommandException(message);

/// <summary>No pending git change matches the node id (HTTP 404).</summary>
public sealed class DiffNotFoundException(string message) : Exception(message);

/// <summary>Repo-root-relative paths git reports as changed-and-present, and as deleted.</summary>
public sealed class WorkingTreeStatus
{
    public List<string> Changed { get; } = [];
    public List<string> Deleted { get; } = [];

    /// <summary>Per-path "added" | "modified" | "deleted", insertion-ordered.</summary>
    public InsertionMap<string> Statuses { get; } = new();

    public bool Has(string path) => Statuses.ContainsKey(path);
}

/// <summary>The git subprocess primitives shared by the diff, change-card and accept layers (git_cmd.py).</summary>
public sealed class GitTree
{
    private GitTree(string repoRoot, string gitRoot, string prefix)
    {
        RepoRoot = repoRoot;
        GitRoot = gitRoot;
        Prefix = prefix;
    }

    public string RepoRoot { get; }

    /// <summary>The enclosing repository's top level, as git spells it.</summary>
    public string GitRoot { get; }

    /// <summary>`repoRoot` relative to <see cref="GitRoot"/> with a trailing slash, or "" when they are the same directory.</summary>
    public string Prefix { get; }

    /// <summary>The tree enclosing `repoRoot`, or null when it is not inside a git repository.</summary>
    public static GitTree? Detect(string repoRoot)
    {
        var top = GitRunner.Run(repoRoot, "rev-parse", "--show-toplevel");
        if (top is null) return null;
        var prefix = (GitRunner.Run(repoRoot, "rev-parse", "--show-prefix") ?? "").Trim();
        return new GitTree(Path.GetFullPath(repoRoot), Path.GetFullPath(top.Trim()), prefix);
    }

    public string GitRelative(string filePath) => Prefix + filePath;

    /// <summary>`base`'s bytes for filePath, or empty when it didn't exist there or there is no commit yet.</summary>
    public byte[] HeadContent(string filePath, string baseRef = "HEAD")
    {
        var result = Raw(GitRoot, ["show", $"{baseRef}:{GitRelative(filePath)}"]);
        return result is { ExitCode: 0 } found ? found.Stdout : [];
    }

    /// <summary>Everything that differs from `baseRef`, split into present-and-changed vs deleted paths.</summary>
    public WorkingTreeStatus Status(string baseRef = "HEAD") => baseRef == "HEAD" ? Uncommitted() : Against(baseRef);

    /// <summary>Repo-relative path to (additions, deletions) vs `baseRef`; untracked files count all lines added.</summary>
    public Dictionary<string, (int Additions, int Deletions)> LineCounts(string baseRef, IEnumerable<KeyValuePair<string, string>> statuses)
    {
        var counts = new Dictionary<string, (int, int)>();
        foreach (var line in SplitLines(GitRunner.Run(RepoRoot, "diff", "--numstat", "--relative", baseRef, "--", ".") ?? ""))
        {
            var parts = line.Split('	');
            if (parts.Length == 3 && int.TryParse(parts[0], out var added) && int.TryParse(parts[1], out var removed))
                counts[parts[2].Trim().Trim('"')] = (added, removed);
        }
        foreach (var (path, kind) in statuses)
        {
            if (kind != "added" || counts.ContainsKey(path)) continue;
            try { counts[path] = (LineDiff.SplitLines(File.ReadAllText(System.IO.Path.Combine(RepoRoot, path))).Count, 0); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
        }
        return counts;
    }

    private WorkingTreeStatus Uncommitted()
    {
        var status = new WorkingTreeStatus();
        var raw = GitRunner.Run(RepoRoot, "status", "--porcelain", "--untracked-files=all", "--", ".");
        if (raw is null) return status;
        foreach (var line in SplitLines(raw))
        {
            if (line.Length < 4) continue;
            var isDelete = line[0] == 'D' || line[1] == 'D';
            var kind = StatusKind(line[0], line[1], isDelete);
            // A rename reads "old -> new": the delete side is the old path, the change side the new one.
            var parts = line[3..].Split(" -> ");
            var rawPath = (isDelete ? parts[0] : parts[^1]).Trim().Trim('"');
            if (rawPath.Length == 0) continue;
            if (Resolve(rawPath) is not { } resolved) continue;
            var (absolute, relative) = resolved;
            if (isDelete)
            {
                if (!Exists(absolute))
                {
                    status.Deleted.Add(relative);
                    status.Statuses[relative] = kind;
                }
            }
            else if (File.Exists(absolute))
            {
                status.Changed.Add(relative);
                status.Statuses[relative] = kind;
            }
        }
        return status;
    }

    /// <summary>Working tree vs a commit: `git diff` covers tracked files, `status` the untracked ones.</summary>
    private WorkingTreeStatus Against(string baseRef)
    {
        var status = new WorkingTreeStatus();
        var raw = GitRunner.Run(RepoRoot, "diff", "--name-status", baseRef, "--", ".");
        // An unreachable base gives nothing honest to diff against: report nothing, don't guess.
        if (raw is null) return status;
        foreach (var line in SplitLines(raw))
        {
            var parts = line.Split('\t');
            if (parts.Length < 2) continue;
            var code = parts[0][..Math.Min(1, parts[0].Length)];
            var rawPath = code != "D" ? parts[^1] : parts[1];
            Record(status, rawPath, code switch { "A" => "added", "D" => "deleted", _ => "modified" });
        }
        var untracked = GitRunner.Run(RepoRoot, "status", "--porcelain", "--untracked-files=all", "--", ".");
        foreach (var line in SplitLines(untracked ?? ""))
            if (line.StartsWith("??", StringComparison.Ordinal) && line.Length > 3) Record(status, line[3..].Trim().Trim('"'), "added");
        return status;
    }

    private void Record(WorkingTreeStatus status, string rawPath, string kind)
    {
        if (rawPath.Length == 0 || Resolve(rawPath) is not { } resolved) return;
        var (absolute, relative) = resolved;
        if (status.Has(relative)) return;
        if (kind == "deleted" || !Exists(absolute))
        {
            if (Exists(absolute)) return;
            status.Deleted.Add(relative);
            status.Statuses[relative] = "deleted";
        }
        else if (File.Exists(absolute))
        {
            status.Changed.Add(relative);
            status.Statuses[relative] = kind;
        }
    }

    private static bool Exists(string path) => File.Exists(path) || Directory.Exists(path);

    private static string StatusKind(char index, char worktree, bool isDelete)
    {
        if (isDelete) return "deleted";
        return index == 'A' || worktree == 'A' || (index == '?' && worktree == '?') ? "added" : "modified";
    }

    /// <summary>Re-relativizes a git-root path to the repo root; null when it lies outside it.</summary>
    private (string Absolute, string Relative)? Resolve(string rawPath)
    {
        if (Prefix.Length > 0 && !rawPath.StartsWith(Prefix, StringComparison.Ordinal)) return null;
        var relative = rawPath[Prefix.Length..];
        if (relative.Split('/').Contains("..")) return null;
        return (Path.GetFullPath(Path.Combine(GitRoot, rawPath)), relative);
    }

    private static IEnumerable<string> SplitLines(string text) => text.Split('\n').Select(l => l.TrimEnd('\r')).Where(l => l.Length > 0);

    /// <summary>One git subprocess with raw bytes in and out; null when git could not run or timed out.</summary>
    internal static (int ExitCode, byte[] Stdout, string Stderr)? Raw(
        string cwd, IReadOnlyList<string> args, IReadOnlyDictionary<string, string>? env = null, string? stdin = null)
    {
        var info = new ProcessStartInfo("git")
        {
            WorkingDirectory = cwd,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = stdin is not null,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var arg in args) info.ArgumentList.Add(arg);
        foreach (var (key, value) in env ?? new Dictionary<string, string>()) info.Environment[key] = value;
        try
        {
            using var process = Process.Start(info)!;
            var stdout = Task.Run(() =>
            {
                using var memory = new MemoryStream();
                process.StandardOutput.BaseStream.CopyTo(memory);
                return memory.ToArray();
            });
            var stderr = process.StandardError.ReadToEndAsync();
            if (stdin is not null)
            {
                var bytes = new UTF8Encoding(false).GetBytes(stdin);
                process.StandardInput.BaseStream.Write(bytes, 0, bytes.Length);
                process.StandardInput.Close();
            }
            if (!process.WaitForExit(TimeSpan.FromSeconds(BridgeLimits.GitShortTimeoutSeconds)))
            {
                try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                return null;
            }
            return (process.ExitCode, stdout.GetAwaiter().GetResult(), stderr.GetAwaiter().GetResult());
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException or IOException)
        {
            return null;
        }
    }

    /// <summary>run_git's raising twin: accepting a diff must surface why git refused, not swallow it.</summary>
    internal static string Required(
        string cwd, IReadOnlyList<string> args, IReadOnlyDictionary<string, string>? env = null, string? stdin = null)
    {
        var command = $"git {string.Join(' ', args)}";
        var result = Raw(cwd, args, env, stdin) ?? throw new GitCommandException($"{command} could not be run");
        if (result.ExitCode == 0) return Encoding.UTF8.GetString(result.Stdout);
        var stderr = result.Stderr.Trim();
        throw new GitCommandException($"{command} failed{(stderr.Length > 0 ? ": " + stderr : $" exited {result.ExitCode}")}");
    }
}
