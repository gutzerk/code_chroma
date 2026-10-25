using CodeChroma.Bridge.Engine;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Tests.Contract;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Tests.Workspaces;

public class DiffBaseTests
{
    private static Workspace Make(string id, string root, string? baseRef) =>
        new(id, root, new JsonSnapshotEngine(Path.Combine(ContractCases.FixtureDir, "engine_snapshot.sample_repo.json")), (_, _) => { }) { BaseRef = baseRef };

    [Fact]
    public void Main_always_diffs_against_head()
    {
        using var repo = new GitSandbox();

        Assert.Equal("HEAD", Make(Workspace.MainId, repo.Root, "whatever").DiffBase());
    }

    [Fact]
    public void A_stored_base_ref_wins_over_the_integration_branch()
    {
        using var repo = new GitSandbox();
        repo.Git("branch", "pr-base");
        var forkPoint = repo.Git("rev-parse", "HEAD").Trim();
        repo.Write("app.py", "value = 2\n");
        repo.CommitAll("main moves on");

        var baseRef = Make("pr-1", repo.Root, "pr-base").DiffBase();

        Assert.Equal(forkPoint, baseRef);
    }

    [Fact]
    public void Without_a_base_ref_the_integration_branch_is_used()
    {
        using var repo = new GitSandbox();
        var head = repo.Git("rev-parse", "HEAD").Trim();

        Assert.Equal(head, Make("agent1", repo.Root, null).DiffBase());
    }
}
