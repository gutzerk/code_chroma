using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Tests.Support;

namespace CodeChroma.Bridge.Tests.Agents;

[CollectionDefinition("Env", DisableParallelization = true)]
public class EnvCollection;

/// <summary>`git worktree` wrappers against real repositories (port of tests/unit/test_agent_worktree.py).</summary>
[Collection("Env")]
public class WorktreeOpsTests : IDisposable
{
    private readonly GitSandbox _repo = new();
    private readonly string? _previousEnv = Environment.GetEnvironmentVariable(WorktreeOps.WorkspacesDirEnv);

    public WorktreeOpsTests() => Environment.SetEnvironmentVariable(WorktreeOps.WorkspacesDirEnv, null);

    public void Dispose()
    {
        Environment.SetEnvironmentVariable(WorktreeOps.WorkspacesDirEnv, _previousEnv);
        _repo.Dispose();
    }

    private string PathFor(string id) => WorktreeOps.WorktreePath(_repo.Root, id);

    [Fact]
    public void Add_creates_a_branch_and_a_populated_directory()
    {
        var path = WorktreeOps.Add(_repo.Root, "agent/one", PathFor("one"));

        Assert.True(File.Exists(Path.Combine(path, "app.py")));
        Assert.Contains("agent/one", WorktreeOps.ListAgentBranches(_repo.Root));
    }

    [Fact]
    public void Add_surfaces_git_stderr_on_failure()
    {
        WorktreeOps.Add(_repo.Root, "agent/one", PathFor("one"));

        var error = Assert.Throws<WorktreeException>(() => WorktreeOps.Add(_repo.Root, "agent/one", PathFor("two")));

        Assert.StartsWith("git worktree add failed:", error.Message);
        Assert.Contains("agent/one", error.Message);
    }

    [Fact]
    public void Add_detached_creates_no_branch_at_all()
    {
        var head = _repo.Git("rev-parse", "HEAD").Trim();

        var path = WorktreeOps.AddDetached(_repo.Root, PathFor("pr-1"), head);

        Assert.True(File.Exists(Path.Combine(path, "app.py")));
        Assert.Null(WorktreeOps.ListWorktrees(_repo.Root).Single(e => e.Path.EndsWith("pr-1", StringComparison.Ordinal)).Branch);
    }

    [Fact]
    public void Checkout_detached_moves_a_worktree_and_refuses_over_a_local_edit()
    {
        var first = _repo.Git("rev-parse", "HEAD").Trim();
        _repo.Write("app.py", "value = 2\n");
        _repo.CommitAll("second");
        var second = _repo.Git("rev-parse", "HEAD").Trim();
        var path = WorktreeOps.AddDetached(_repo.Root, PathFor("pr-2"), first);

        WorktreeOps.CheckoutDetached(path, second);
        File.WriteAllText(Path.Combine(path, "app.py"), "dirty\n");
        var refused = Assert.Throws<WorktreeException>(() => WorktreeOps.CheckoutDetached(path, first));

        Assert.Contains("app.py", refused.Message);
        Assert.Equal("dirty\n", File.ReadAllText(Path.Combine(path, "app.py")));
    }

    [Fact]
    public void Remove_deletes_the_directory_but_keeps_the_branch_and_refuses_a_dirty_one_without_force()
    {
        var path = WorktreeOps.Add(_repo.Root, "agent/keep", PathFor("keep"));
        File.WriteAllText(Path.Combine(path, "scratch.txt"), "unsaved");

        Assert.Throws<WorktreeException>(() => WorktreeOps.Remove(_repo.Root, path));
        WorktreeOps.Remove(_repo.Root, path, force: true);

        Assert.False(Directory.Exists(path));
        Assert.Contains("agent/keep", WorktreeOps.ListAgentBranches(_repo.Root));
    }

    [Fact]
    public void Delete_branch_removes_the_branch()
    {
        var path = WorktreeOps.Add(_repo.Root, "agent/gone", PathFor("gone"));
        WorktreeOps.Remove(_repo.Root, path);

        WorktreeOps.DeleteBranch(_repo.Root, "agent/gone");

        Assert.DoesNotContain("agent/gone", WorktreeOps.ListAgentBranches(_repo.Root));
    }

    [Fact]
    public void Prune_recovers_after_the_directory_is_deleted_by_hand()
    {
        var path = WorktreeOps.Add(_repo.Root, "agent/lost", PathFor("lost"));
        Directory.Delete(path, recursive: true);

        WorktreeOps.Prune(_repo.Root);

        Assert.DoesNotContain(WorktreeOps.ListWorktrees(_repo.Root), e => e.Branch == "agent/lost");
        WorktreeOps.Attach(_repo.Root, "agent/lost", path);
        Assert.True(File.Exists(Path.Combine(path, "app.py")));
    }

    [Fact]
    public void List_worktrees_reports_path_and_branch()
    {
        WorktreeOps.Add(_repo.Root, "agent/listed", PathFor("listed"));

        var entries = WorktreeOps.ListWorktrees(_repo.Root);

        Assert.Contains(entries, e => e.Branch == "main");
        Assert.Contains(entries, e => e.Branch == "agent/listed" && e.Path.EndsWith("listed", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("Fix the Login Bug!", "fix-the-login-bug")]
    [InlineData("  ---  ", "agent1")]
    [InlineData("Café über", "cafe-uber")]
    [InlineData("../../etc/passwd", "etc-passwd")]
    public void Slugify_survives_hostile_titles(string title, string expected)
    {
        Assert.Equal(expected, CodeChroma.Bridge.Workspaces.BranchManager.Slugify(title, 1));
    }

    [Fact]
    public void Worktrees_live_under_the_repository_by_default()
    {
        Assert.Equal(Path.Combine(_repo.Root, ".codechroma", "worktrees", "x"), PathFor("x"));
        Assert.Equal("agent/x", WorktreeOps.BranchName("x"));
    }

    [Fact]
    public void The_env_override_wins_and_keeps_a_per_repo_level()
    {
        var elsewhere = _repo.Sibling("elsewhere");
        Environment.SetEnvironmentVariable(WorktreeOps.WorkspacesDirEnv, elsewhere);

        var path = PathFor("x");

        Assert.Equal(Path.Combine(elsewhere, "project", "x"), path);
    }

    [Fact]
    public void Move_relocates_a_worktree_carrying_uncommitted_work()
    {
        var source = WorktreeOps.Add(_repo.Root, "agent/mover", PathFor("mover"));
        File.WriteAllText(Path.Combine(source, "wip.txt"), "in progress");
        var target = Path.Combine(_repo.Sibling("moved"), "mover");

        WorktreeOps.Move(_repo.Root, source, target);

        Assert.Equal("in progress", File.ReadAllText(Path.Combine(target, "wip.txt")));
        Assert.Contains(WorktreeOps.ListWorktrees(_repo.Root), e => e.Branch == "agent/mover" && Path.GetFullPath(e.Path) == Path.GetFullPath(target));
    }

    [Fact]
    public void Main_branch_falls_back_to_the_local_default()
    {
        Assert.Equal("main", WorktreeOps.MainBranch(_repo.Root));
    }
}

public class MainBranchOpsTests : IDisposable
{
    private readonly GitSandbox _repo = new();

    public void Dispose() => _repo.Dispose();

    [Fact]
    public void Current_branch_reads_mains_checkout_and_is_null_when_detached()
    {
        Assert.Equal("main", MainBranchOps.CurrentBranch(_repo.Root));

        _repo.Git("checkout", "-q", "--detach");

        Assert.Null(MainBranchOps.CurrentBranch(_repo.Root));
    }
}
