using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Agents;

public sealed record WorktreeEntry(string Path, string? Head, string? Branch);

/// <summary>Thin wrappers over `git worktree`, plus the branch/directory slug and where worktrees live (agents/worktree.py).</summary>
public static class WorktreeOps
{
    public const string WorkspacesDirEnv = "codechroma_WORKSPACES_DIR";
    public const string BranchPrefix = "agent/";
    private const int MaxSubmoduleDepth = 5;

    /// <summary>$codechroma_WORKSPACES_DIR when set, else &lt;repo&gt;/.codechroma/worktrees.</summary>
    public static string WorktreesRoot(string repoRoot)
    {
        var configured = Environment.GetEnvironmentVariable(WorkspacesDirEnv)?.Trim();
        if (!string.IsNullOrEmpty(configured)) return Path.GetFullPath(ExpandUser(configured));
        return Path.Combine(repoRoot, ".codechroma", "worktrees");
    }

    /// <summary>Where worktrees used to live; read only by the one-time migration.</summary>
    public static string LegacyWorktreesRoot() =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codechroma", "worktrees");

    /// <summary>&lt;repo&gt;/.codechroma/worktrees/&lt;id&gt;, or &lt;env&gt;/&lt;repo-slug&gt;/&lt;id&gt; when overridden.</summary>
    public static string WorktreePath(string repoRoot, string agentId)
    {
        if (!string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(WorkspacesDirEnv)))
            return Path.Combine(WorktreesRoot(repoRoot), BranchManager.Slugify(Path.GetFileName(repoRoot.TrimEnd('\\', '/')), 1), agentId);
        return Path.Combine(WorktreesRoot(repoRoot), agentId);
    }

    /// <summary>The branch an agent works on, namespaced so it never collides with a human's branch.</summary>
    public static string BranchName(string agentId) => BranchPrefix + agentId;

    public static string Add(string repoRoot, string branch, string path, string? startPoint = null, bool track = true)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var args = new List<string> { "worktree", "add" };
        if (!track) args.Add("--no-track");
        args.AddRange(["-b", branch, path]);
        if (startPoint is not null) args.Add(startPoint);
        RunOrThrow(repoRoot, "git worktree add", [.. args]);
        return path;
    }

    /// <summary>`git worktree add &lt;path&gt; &lt;branch&gt;`: recreates a checkout for an existing branch.</summary>
    public static string Attach(string repoRoot, string branch, string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        RunOrThrow(repoRoot, "git worktree add", "worktree", "add", path, branch);
        return path;
    }

    /// <summary>A checkout of a commit with no branch at all: a fetched PR head gets no local branch to hold hostage.</summary>
    public static string AddDetached(string repoRoot, string path, string commit)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        RunOrThrow(repoRoot, "git worktree add", "worktree", "add", "--detach", path, commit);
        return path;
    }

    /// <summary>Moves an existing detached worktree onto another commit; no --force, so git refusing over a local edit is information.</summary>
    public static void CheckoutDetached(string worktreePath, string commit)
    {
        try { GitLong.Run(worktreePath, "checkout", "--detach", commit); }
        catch (GitLongException error) { throw new WorktreeException(error.Message); }
    }

    public static void Remove(string repoRoot, string path, bool force = false)
    {
        var args = new List<string> { "worktree", "remove" };
        if (force) args.Add("--force");
        args.Add(path);
        RunOrThrow(repoRoot, "git worktree remove", [.. args]);
    }

    /// <summary>`git reset --hard &lt;commit&gt;` inside a worktree: moves its branch and files back to the commit.</summary>
    private static void ResetHard(string worktreePath, string commit) =>
        RunOrThrow(worktreePath, "git reset", "reset", "--hard", commit);

    /// <summary>Commits the worktree's state under `message`, keeps that head on a new branch (a numeric suffix if the name is taken), resets to `resetTo`, and returns the branch used.</summary>
    public static string SetAside(string repoRoot, string worktree, string branch, string resetTo, string message)
    {
        CommitAll(worktree, message);
        var head = GitRunner.Run(worktree, "rev-parse", "HEAD")?.Trim();
        if (string.IsNullOrEmpty(head)) throw new WorktreeException("could not read the worktree head");
        var unique = CreateUniqueBranch(repoRoot, branch, head);
        try
        {
            ResetHard(worktree, resetTo);
        }
        catch (WorktreeException error)
        {
            GitRunner.RunRaw(repoRoot, "branch", "-D", unique);
            throw new WorktreeException($"could not reset the worktree after keeping the attempt on {unique} (the branch was removed again): {error.Message}");
        }
        return unique;
    }

    /// <summary>Creates `branch` (or `branch-2`, `-3`, ...) at `startPoint`; a failed create only retries when that name really exists.</summary>
    private static string CreateUniqueBranch(string repoRoot, string branch, string startPoint)
    {
        for (var n = 1; ; n++)
        {
            var candidate = n == 1 ? branch : $"{branch}-{n}";
            var result = GitRunner.RunRaw(repoRoot, "branch", candidate, startPoint);
            if (result is { ExitCode: 0 }) return candidate;
            if (result is null || !BranchExists(repoRoot, candidate))
                throw new WorktreeException("git branch create " + (result is null ? "could not be run" : $"failed: {result.Value.Stderr.Trim()}"));
        }
    }

    private static bool BranchExists(string repoRoot, string branch) =>
        GitRunner.RunRaw(repoRoot, "show-ref", "--verify", "--quiet", "refs/heads/" + branch) is { ExitCode: 0 };

    /// <summary>Stages everything and commits it (even when empty) under a fixed identity; returns the new head.</summary>
    public static string? CommitAll(string worktree, string message)
    {
        if (GitRunner.RunRaw(worktree, "add", "-A") is not { ExitCode: 0 }) return null;
        var commit = GitRunner.RunRaw(worktree, "-c", "user.name=CodeChroma", "-c", "user.email=codechroma@localhost", "-c", "commit.gpgsign=false",
            "commit", "--allow-empty", "--no-verify", "-m", message);
        if (commit is not { ExitCode: 0 }) return null;
        return GitRunner.Run(worktree, "rev-parse", "HEAD")?.Trim();
    }

    public static void RenameBranch(string repoRoot, string from, string to) =>
        RunOrThrow(repoRoot, "git branch rename", "branch", "-m", from, to);

    public static void DeleteBranch(string repoRoot, string branch, bool force = true) =>
        RunOrThrow(repoRoot, "git branch delete", "branch", force ? "-D" : "-d", branch);

    /// <summary>`git worktree move`, falling back to a directory move plus `git worktree repair`.</summary>
    public static void Move(string repoRoot, string source, string target)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        var result = GitRunner.RunRaw(repoRoot, "worktree", "move", source, target);
        if (result is { ExitCode: 0 })
        {
            RepairSubmoduleGitDirs(source, target);
            return;
        }
        var reason = result is null ? "git could not be run" : result.Value.Stderr.Trim();
        try { Directory.Move(source, target); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new WorktreeException($"{reason}; moving the directory also failed: {error.Message}");
        }
        if (GitRunner.Run(repoRoot, "worktree", "repair", target) is null)
            throw new WorktreeException($"{reason}; `git worktree repair {target}` then failed too");
        RepairSubmoduleGitDirs(source, target);
    }

    /// <summary>`git worktree prune`, run at startup so a hand-deleted directory stops haunting git.</summary>
    public static void Prune(string repoRoot) => GitRunner.Run(repoRoot, "worktree", "prune");

    public static List<WorktreeEntry> ListWorktrees(string repoRoot)
    {
        var raw = GitRunner.Run(repoRoot, "worktree", "list", "--porcelain");
        var entries = new List<WorktreeEntry>();
        if (raw is null) return entries;
        string? path = null, head = null, branch = null;
        foreach (var line in raw.Split('\n').Select(l => l.TrimEnd('\r')))
        {
            if (line.Trim().Length == 0)
            {
                if (path is not null) entries.Add(new WorktreeEntry(path, head, branch));
                path = head = branch = null;
                continue;
            }
            var space = line.IndexOf(' ');
            var key = space < 0 ? line : line[..space];
            var value = space < 0 ? "" : line[(space + 1)..];
            switch (key)
            {
                case "worktree": path = value; break;
                case "HEAD": head = value; break;
                case "branch": branch = value.StartsWith("refs/heads/", StringComparison.Ordinal) ? value["refs/heads/".Length..] : value; break;
            }
        }
        if (path is not null) entries.Add(new WorktreeEntry(path, head, branch));
        return entries;
    }

    /// <summary>Every local branch under agent/, including ones no live worktree points at any more.</summary>
    public static List<string> ListAgentBranches(string repoRoot) =>
        (GitRunner.Run(repoRoot, "branch", "--list", BranchPrefix + "*", "--format=%(refname:short)") ?? "")
            .Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(l => l.Trim()).Where(l => l.Length > 0).ToList();

    /// <summary>The integration branch: origin's default when known, else main/master, else HEAD.</summary>
    public static string MainBranch(string repoRoot)
    {
        var remoteHead = GitRunner.Run(repoRoot, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD");
        if (!string.IsNullOrWhiteSpace(remoteHead))
        {
            var name = remoteHead.Trim();
            name = name.StartsWith("refs/remotes/origin/", StringComparison.Ordinal) ? name["refs/remotes/origin/".Length..] : name;
            if (name.Length > 0) return name;
        }
        foreach (var candidate in new[] { "main", "master" })
            if (!string.IsNullOrWhiteSpace(GitRunner.Run(repoRoot, "rev-parse", "--verify", "--quiet", $"refs/heads/{candidate}")))
                return candidate;
        var current = GitRunner.Run(repoRoot, "rev-parse", "--abbrev-ref", "HEAD")?.Trim();
        return string.IsNullOrEmpty(current) ? "HEAD" : current;
    }

    private static void RunOrThrow(string repoRoot, string description, params string[] args)
    {
        var result = GitRunner.RunRaw(repoRoot, args);
        if (result is null) throw new WorktreeException($"{description} could not be run");
        if (result.Value.ExitCode == 0) return;
        var stderr = result.Value.Stderr.Trim();
        throw new WorktreeException($"{description} failed" + (stderr.Length > 0 ? $": {stderr}" : $" exited {result.Value.ExitCode}"));
    }

    private static string ExpandUser(string path) =>
        path.StartsWith('~') ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) + path[1..] : path;

    /// <summary>Re-anchors each submodule's two pointers (.git -> gitdir, core.worktree), which neither `move` nor `repair` rewrites.</summary>
    private static void RepairSubmoduleGitDirs(string source, string target)
    {
        foreach (var gitFile in SubmoduleGitFiles(target, 0))
        {
            var gitDir = RepointedGitDir(gitFile, source, target);
            if (gitDir is null) continue;
            var workTree = Path.GetDirectoryName(gitFile)!;
            File.WriteAllText(gitFile, $"gitdir: {Path.GetRelativePath(workTree, gitDir).Replace('\\', '/')}\n");
            var info = new System.Diagnostics.ProcessStartInfo("git") { WorkingDirectory = workTree, RedirectStandardError = true, RedirectStandardOutput = true };
            foreach (var arg in new[] { "config", "core.worktree", Path.GetRelativePath(gitDir, workTree).Replace('\\', '/') }) info.ArgumentList.Add(arg);
            info.Environment["GIT_DIR"] = gitDir;
            info.Environment["GIT_WORK_TREE"] = workTree;
            using var process = System.Diagnostics.Process.Start(info)!;
            process.StandardOutput.ReadToEnd();
            process.StandardError.ReadToEnd();
            process.WaitForExit();
            if (process.ExitCode != 0) throw new WorktreeException($"could not repoint the submodule at {workTree} after the move");
        }
    }

    private static string? RepointedGitDir(string gitFile, string source, string target)
    {
        var pointer = File.ReadAllText(gitFile).Trim();
        if (!pointer.StartsWith("gitdir:", StringComparison.Ordinal)) return null;
        var recorded = pointer["gitdir:".Length..].Trim();
        var parent = Path.GetDirectoryName(gitFile)!;
        if (Directory.Exists(Path.GetFullPath(Path.Combine(parent, recorded)))) return null;
        var wasAt = Path.Combine(source, Path.GetRelativePath(target, parent));
        var resolved = Path.GetFullPath(Path.Combine(wasAt, recorded));
        return Directory.Exists(resolved) ? resolved : null;
    }

    private static List<string> SubmoduleGitFiles(string root, int depth)
    {
        var found = new List<string>();
        if (depth > MaxSubmoduleDepth) return found;
        foreach (var relative in SubmodulePaths(Path.Combine(root, ".gitmodules")))
        {
            var candidate = Path.Combine(root, relative);
            if (File.Exists(Path.Combine(candidate, ".git"))) found.Add(Path.Combine(candidate, ".git"));
            found.AddRange(SubmoduleGitFiles(candidate, depth + 1));
        }
        return found;
    }

    private static List<string> SubmodulePaths(string gitmodules)
    {
        try
        {
            return File.ReadAllLines(gitmodules)
                .Select(line => line.Split('=', 2))
                .Where(parts => parts.Length == 2 && parts[0].Trim() == "path" && parts[1].Trim().Length > 0)
                .Select(parts => parts[1].Trim()).ToList();
        }
        catch (IOException) { return []; }
    }
}
