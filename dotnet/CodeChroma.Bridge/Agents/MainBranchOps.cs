using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Agents;

/// <summary>No local branch by that name (404).</summary>
public sealed class UnknownBranchException(string branch) : BridgeException(404, branch);

/// <summary>The checkout would overwrite or remove local work (409).</summary>
public sealed class DirtyWorkingTreeException(string message) : BridgeException(409, message);

/// <summary>A known, clean-tree branch still failed to check out, for example because another worktree holds it (409).</summary>
public sealed class CheckoutException(string message) : BridgeException(409, message);

/// <summary>The main repo's checked-out branch: read it, list local branches, switch it safely (agents/main_branch.py).</summary>
public static class MainBranchOps
{
    /// <summary>Git's own refusal text for both conflict shapes (overwritten or removed) ends with this line.</summary>
    private const string RealConflictMarker = "before you switch branches";

    public static string? CurrentBranch(string repoRoot) => BranchManager.CurrentBranch(repoRoot);

    public static IReadOnlyList<string> ListBranches(string repoRoot) => BranchManager.ListBranches(repoRoot);

    /// <summary>The branches `checkout` can actually reach: every local one no other worktree holds.</summary>
    public static List<string> SwitchableBranches(string repoRoot)
    {
        var gitRoot = Path.GetFullPath((GitRunner.Run(repoRoot, "rev-parse", "--show-toplevel") ?? repoRoot).Trim());
        var held = WorktreeOps.ListWorktrees(repoRoot)
            .Where(e => e.Branch is not null && !SamePath(e.Path, gitRoot))
            .Select(e => e.Branch!).ToHashSet();
        return ListBranches(repoRoot).Where(b => !held.Contains(b)).ToList();
    }

    /// <summary>Switches main's tree to `branch`; local work rides along unless it collides with it.</summary>
    public static string Checkout(string repoRoot, string branch)
    {
        if (!ListBranches(repoRoot).Contains(branch)) throw new UnknownBranchException(branch);
        var result = GitRunner.RunRaw(repoRoot, "checkout", branch) ?? throw new CheckoutException($"git checkout {branch} could not run");
        if (result.ExitCode == 0) return branch;
        var stderr = result.Stderr.Trim();
        if (stderr.Contains(RealConflictMarker, StringComparison.Ordinal)) throw new DirtyWorkingTreeException(stderr.Length > 0 ? stderr : branch);
        throw new CheckoutException(stderr.Length > 0 ? stderr : $"git checkout {branch} failed");
    }

    /// <summary>Fast-forwards main's current branch from its upstream; `git pull --ff-only` never invents history.</summary>
    public static string? UpdateBranch(string repoRoot)
    {
        GitLong.Run(repoRoot, "pull", "--ff-only");
        return CurrentBranch(repoRoot);
    }

    private static bool SamePath(string a, string b) =>
        string.Equals(Path.GetFullPath(a).TrimEnd('\\', '/'), Path.GetFullPath(b).TrimEnd('\\', '/'),
            OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);
}
