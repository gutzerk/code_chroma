using CodeChroma.Bridge.Agents;

namespace CodeChroma.Bridge.Prs;

/// <summary>
/// Fetching a pull request's head into a detached worktree the canvas can analyze. The refs land under our own
/// refs/codechroma/pr/&lt;n&gt;/ namespace, never refs/remotes/origin/*, so the user's ahead/behind and `git log origin/main` are
/// untouched. The same fetch brings the base branch down so diff_base resolves. The worktree is detached: a review never
/// creates a local branch. Skills ARE installed into it so a read-only PR can still run diagram skills.
/// </summary>
public static class PrImporter
{
    private const string RefRoot = "refs/codechroma/pr";

    public static string WorkspaceId(int number) => PrRecord.IdPrefix + number;

    /// <summary>Where this bridge keeps the pull request's head: our namespace, not a remote-tracking ref.</summary>
    public static string LocalHeadRef(int number) => $"{RefRoot}/{number}/head";

    public static string LocalBaseRef(int number) => $"{RefRoot}/{number}/base";

    /// <summary>Beside the agents' worktrees, so $codechroma_WORKSPACES_DIR moves both at once.</summary>
    public static string WorktreePath(string mainRoot, int number) => WorktreeOps.WorktreePath(mainRoot, WorkspaceId(number));

    /// <summary>One round trip for both refs; throws GitLongException with a reason the route can render.</summary>
    public static void FetchRefs(string mainRoot, int number, string baseRefName) =>
        GitLong.Run(mainRoot, "fetch", "--no-tags", "origin", $"+refs/pull/{number}/head:{LocalHeadRef(number)}", $"+refs/heads/{baseRefName}:{LocalBaseRef(number)}");

    public static string? HeadSha(string mainRoot, int number)
    {
        var resolved = Workspaces.GitRunner.Run(mainRoot, "rev-parse", "--verify", "--quiet", LocalHeadRef(number))?.Trim();
        return string.IsNullOrEmpty(resolved) ? null : resolved;
    }

    /// <summary>Fetches the pull request and checks its head out detached; returns (worktree, head sha).</summary>
    public static (string Path, string Sha) Import(string mainRoot, int number, string baseRefName)
    {
        GitExclude.Ensure(mainRoot, [.. SkillSync.WorktreeExcludes]);
        FetchRefs(mainRoot, number, baseRefName);
        var sha = HeadSha(mainRoot, number) ?? throw new WorktreeException($"fetched no head for pull request {number}");
        var path = WorktreePath(mainRoot, number);
        WorktreeOps.AddDetached(mainRoot, path, sha);
        SkillSync.InstallIntoWorktree(path);
        return (path, sha);
    }

    /// <summary>Re-fetches and moves the worktree if the head moved; returns (head sha, whether it moved).</summary>
    public static (string Sha, bool Moved) Refresh(string mainRoot, int number, string path, string baseRefName, string currentSha)
    {
        FetchRefs(mainRoot, number, baseRefName);
        var sha = HeadSha(mainRoot, number) ?? throw new WorktreeException($"fetched no head for pull request {number}");
        if (sha == currentSha && Directory.Exists(path)) return (sha, false);
        if (!Directory.Exists(path))
        {
            WorktreeOps.Prune(mainRoot);
            WorktreeOps.AddDetached(mainRoot, path, sha);
            SkillSync.InstallIntoWorktree(path);
            return (sha, true);
        }
        WorktreeOps.CheckoutDetached(path, sha);
        return (sha, true);
    }

    /// <summary>Drops the worktree and both refs; leaving the refs would pin a fork's objects forever. Nothing in a PR worktree is the user's own work.</summary>
    public static void Remove(string mainRoot, int number, string path)
    {
        if (Directory.Exists(path)) WorktreeOps.Remove(mainRoot, path, force: true);
        WorktreeOps.Prune(mainRoot);
        foreach (var reference in new[] { LocalHeadRef(number), LocalBaseRef(number) })
            Workspaces.GitRunner.Run(mainRoot, "update-ref", "-d", reference);
    }
}
