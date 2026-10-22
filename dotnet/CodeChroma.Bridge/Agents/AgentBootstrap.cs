using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Agents;

/// <summary>Initialization could not produce a repository with a real first commit (400).</summary>
public sealed class BootstrapException(string message) : BridgeException(400, message);

/// <summary>
/// Repository preflight and the first commit, so agents work on a folder that is not under git yet. `git worktree add` is
/// impossible while a repository has no commits, so enabling agents on a fresh folder commits the project's real code,
/// which is why a plan (file count, bytes, suspicious paths) is computed first. An existing .gitignore is never rewritten.
/// </summary>
public static class AgentBootstrap
{
    public const string StateReady = "ready";
    public const string StateNoGit = "no-git";
    public const string StateNotARepo = "not-a-repo";
    public const string StateNoCommits = "no-commits";
    public const string StateNested = "nested";
    public const int LargeFileBytes = 5 * 1024 * 1024;

    private const string FirstCommitMessage = "Initial commit";

    private static readonly string[] BaseIgnores = ["node_modules/", "dist/", "build/", "__pycache__/", ".venv/", "venv/", ".codechroma/"];
    private static readonly HashSet<string> HeavyDirs = [.. BridgeLimits.IgnoredDirs, ".claude"];
    private static readonly string[] SecretGlobs = [".env", ".env.*", "*.pem", "*.key", "id_rsa", "id_rsa.*"];
    private static readonly HashSet<string> AlwaysIgnored = [".git", ".codechroma"];
    private static readonly string[] MacMediaFolders = ["Music", "Pictures", "Movies", "Library"];

    /// <summary>Repository state plus, when initialization is possible, the plan for the first commit.</summary>
    public static JsonObject Preflight(string root)
    {
        root = Full(root);
        if (GitRunner.Run(root, "--version") is null) return new JsonObject { ["state"] = StateNoGit, ["root"] = root };
        var toplevel = GitRunner.Run(root, "rev-parse", "--show-toplevel");
        if (toplevel is null) return new JsonObject { ["state"] = StateNotARepo, ["root"] = root, ["plan"] = CommitPlan(root) };
        var resolved = Full(toplevel.Trim());
        if (!SamePath(resolved, root)) return new JsonObject { ["state"] = StateNested, ["root"] = root, ["parent_repo"] = resolved };
        if (GitRunner.Run(root, "rev-parse", "--verify", "--quiet", "HEAD") is null)
            return new JsonObject { ["state"] = StateNoCommits, ["root"] = root, ["plan"] = CommitPlan(root) };
        return new JsonObject { ["state"] = StateReady, ["root"] = root };
    }

    /// <summary>The first commit as it lands: every suspicious path excluded unless `include` keeps it.</summary>
    public static JsonObject CommitPlan(string root, IEnumerable<string>? extraIgnores = null, IEnumerable<string>? include = null)
    {
        var scanned = Walk(root);
        var baseRules = EffectiveIgnores(root).Concat(extraIgnores ?? []).ToList();
        var suspicious = Suspicious(scanned, new IgnoreRules(baseRules));
        var kept = (include ?? []).ToHashSet();
        var rules = new IgnoreRules(baseRules
            .Concat(suspicious.Select(e => (string)e["path"]!).Where(p => !kept.Contains(p)))
            .Concat(kept.Select(p => "!" + p)));
        var included = scanned.Where(f => !rules.Ignores(f.Relative)).ToList();
        foreach (var entry in suspicious) entry["preticked"] = !kept.Contains((string)entry["path"]!);
        return new JsonObject
        {
            ["file_count"] = included.Count,
            ["total_bytes"] = included.Sum(f => f.Size),
            ["suspicious"] = new JsonArray(suspicious.Select(e => (JsonNode?)e).ToArray()),
        };
    }

    /// <summary>`git init` (if needed), `.gitignore` (if absent), `git add -A`, the first commit.</summary>
    public static JsonObject Initialize(string root, IEnumerable<string>? extraIgnores = null)
    {
        root = Full(root);
        var state = (string)Preflight(root)["state"]!;
        if (state == StateNoGit) throw new BootstrapException("git is not installed");
        if (state == StateNested) throw new BootstrapException("the project is inside another repository");
        if (state == StateReady) return new JsonObject { ["state"] = StateReady, ["created_repo"] = false, ["created_gitignore"] = false };

        var createdRepo = false;
        if (state == StateNotARepo)
        {
            if (GitRunner.Run(root, "init") is null) throw new BootstrapException("git init failed");
            createdRepo = true;
        }
        var createdGitignore = WriteGitignore(root, extraIgnores ?? []);
        GitExclude.Ensure(root, [".codechroma/", .. SkillSync.ExcludePatterns]);
        if (GitRunner.Run(root, "add", "-A") is null) throw new BootstrapException("git add -A failed");
        if (string.IsNullOrWhiteSpace(GitRunner.Run(root, "diff", "--cached", "--name-only")))
            throw new BootstrapException("nothing to commit — an agent worktree needs a first commit that carries real files");
        Commit(root);
        var head = GitRunner.Run(root, "rev-parse", "HEAD");
        return new JsonObject
        {
            ["state"] = StateReady,
            ["created_repo"] = createdRepo,
            ["created_gitignore"] = createdGitignore,
            ["commit"] = head?.Trim(),
        };
    }

    private static void Commit(string root)
    {
        var result = GitRunner.RunRaw(root, "commit", "-m", FirstCommitMessage);
        if (result is { ExitCode: 0 }) return;
        var retry = GitRunner.RunRaw(root, "-c", "user.name=CodeChroma", "-c", "user.email=codechroma@localhost", "commit", "-m", FirstCommitMessage);
        if (retry is { ExitCode: 0 }) return;
        var detail = retry is null ? "" : retry.Value.Stderr.Trim();
        throw new BootstrapException(detail.Length > 0 ? detail : "git commit failed");
    }

    private static bool WriteGitignore(string root, IEnumerable<string> extraIgnores)
    {
        var path = Path.Combine(root, ".gitignore");
        if (File.Exists(path)) return false;
        var lines = BaseIgnores.Concat(extraIgnores.Where(e => !BaseIgnores.Contains(e)));
        File.WriteAllText(path, string.Join("\n", lines) + "\n", new UTF8Encoding(false));
        return true;
    }

    private static IEnumerable<string> EffectiveIgnores(string root)
    {
        try { return File.ReadAllLines(Path.Combine(root, ".gitignore")); }
        catch (IOException) { return BaseIgnores; }
    }

    private sealed record ScannedFile(string Relative, long Size);

    /// <summary>True for a direct child of the home folder that macOS guards with a TCC prompt (Music, Pictures, Movies, Library).</summary>
    public static bool IsMacProtectedFolder(string path, string? home = null, bool? isMac = null)
    {
        home ??= Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (string.IsNullOrEmpty(home) || !(isMac ?? OperatingSystem.IsMacOS())) return false;
        var parent = Path.GetDirectoryName(Path.TrimEndingDirectorySeparator(Path.GetFullPath(path)));
        return parent is not null && SamePath(parent, Path.GetFullPath(home))
            && MacMediaFolders.Contains(Path.GetFileName(path), StringComparer.Ordinal);
    }

    private static List<ScannedFile> Walk(string root)
    {
        var found = new List<ScannedFile>();
        var stack = new Stack<string>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            var current = stack.Pop();
            IEnumerable<string> entries;
            try { entries = Directory.EnumerateFileSystemEntries(current).ToList(); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { continue; }
            foreach (var entry in entries)
            {
                if (AlwaysIgnored.Contains(Path.GetFileName(entry))) continue;
                if (IsMacProtectedFolder(entry)) continue;
                var attributes = File.GetAttributes(entry);
                if (attributes.HasFlag(FileAttributes.Directory) && !attributes.HasFlag(FileAttributes.ReparsePoint))
                {
                    stack.Push(entry);
                    continue;
                }
                try { found.Add(new ScannedFile(Path.GetRelativePath(root, entry).Replace('\\', '/'), new FileInfo(entry).Length)); }
                catch (IOException) { }
            }
        }
        return found;
    }

    private static string? HeavyAncestor(string relative)
    {
        var parts = relative.Split('/');
        for (var i = 0; i < parts.Length - 1; i++)
            if (HeavyDirs.Contains(parts[i])) return string.Join('/', parts[..(i + 1)]) + "/";
        return null;
    }

    private static List<JsonObject> Suspicious(List<ScannedFile> files, IgnoreRules baseRules)
    {
        var heavy = new SortedDictionary<string, long>(StringComparer.Ordinal);
        foreach (var file in files)
            if (HeavyAncestor(file.Relative) is { } directory) heavy[directory] = heavy.GetValueOrDefault(directory) + file.Size;
        var entries = heavy.Select(kv => Entry(kv.Key, "dependency or build output — usually not committed", kv.Value, baseRules)).ToList();
        foreach (var file in files.OrderBy(f => f.Relative, StringComparer.Ordinal))
        {
            if (HeavyAncestor(file.Relative) is not null) continue;
            var name = file.Relative[(file.Relative.LastIndexOf('/') + 1)..];
            string reason;
            if (SecretGlobs.Any(glob => IgnoreRules.Fnmatch(name, glob))) reason = "may contain credentials or private keys";
            else if (file.Size > LargeFileBytes) reason = "larger than 5 MB";
            else continue;
            entries.Add(Entry(file.Relative, reason, file.Size, baseRules));
        }
        return entries;
    }

    private static JsonObject Entry(string path, string reason, long size, IgnoreRules baseRules) => new()
    {
        ["path"] = path,
        ["reason"] = reason,
        ["size"] = size,
        ["preticked"] = true,
        ["already_ignored"] = baseRules.Ignores(path.TrimEnd('/'), isDir: path.EndsWith('/')),
    };

    private static string Full(string path) => Path.GetFullPath(path).TrimEnd('\\', '/') is { Length: > 0 } trimmed ? trimmed : path;

    private static bool SamePath(string a, string b) =>
        string.Equals(a.Replace('\\', '/').TrimEnd('/'), b.Replace('\\', '/').TrimEnd('/'),
            OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);

    /// <summary>A focused .gitignore matcher: comments, negation, dir-only, anchored and basename globs.</summary>
    private sealed class IgnoreRules
    {
        private readonly List<(bool Negate, string Pattern, bool DirOnly, bool Anchored)> _rules = [];

        public IgnoreRules(IEnumerable<string> lines)
        {
            foreach (var raw in lines)
            {
                var line = raw.Trim();
                if (line.Length == 0 || line.StartsWith('#')) continue;
                var negate = line.StartsWith('!');
                var pattern = negate ? line[1..] : line;
                var dirOnly = pattern.EndsWith('/');
                pattern = pattern.TrimEnd('/');
                var anchored = pattern.StartsWith('/') || pattern.Contains('/');
                _rules.Add((negate, pattern.TrimStart('/'), dirOnly, anchored));
            }
        }

        public bool Ignores(string relative, bool isDir = false)
        {
            var parts = relative.Split('/', StringSplitOptions.RemoveEmptyEntries);
            for (var depth = 1; depth <= parts.Length; depth++)
                if (Matches(string.Join('/', parts[..depth]), isDir || depth < parts.Length)) return true;
            return false;
        }

        private bool Matches(string relative, bool isDir)
        {
            var matched = false;
            var name = relative[(relative.LastIndexOf('/') + 1)..];
            foreach (var (negate, pattern, dirOnly, anchored) in _rules)
            {
                if (dirOnly && !isDir) continue;
                if (Fnmatch(anchored ? relative : name, pattern)) matched = !negate;
            }
            return matched;
        }

        /// <summary>Python's fnmatch: * crosses slashes, ? is one character, [seq] is a class.</summary>
        public static bool Fnmatch(string text, string pattern)
        {
            var regex = new StringBuilder("^");
            for (var i = 0; i < pattern.Length; i++)
            {
                var c = pattern[i];
                if (c == '*') regex.Append(".*");
                else if (c == '?') regex.Append('.');
                else if (c == '[' && pattern.IndexOf(']', i + 1) is var close and > 0)
                {
                    var body = pattern[(i + 1)..close];
                    regex.Append('[').Append(body.StartsWith('!') ? "^" + body[1..] : body).Append(']');
                    i = close;
                }
                else regex.Append(Regex.Escape(c.ToString()));
            }
            return Regex.IsMatch(text, regex.Append('$').ToString(), RegexOptions.Singleline | (OperatingSystem.IsWindows() ? RegexOptions.IgnoreCase : RegexOptions.None));
        }
    }
}
