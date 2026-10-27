using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Agents;

/// <summary>The main repo's checked-out branch, read-only: worktree tabs replaced switching and updating it.</summary>
public static class MainBranchOps
{
    public static string? CurrentBranch(string repoRoot) => BranchManager.CurrentBranch(repoRoot);
}
