using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Stores;
using Microsoft.Extensions.DependencyInjection;
using CodeChroma.Bridge.Terminal;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Workflows;

namespace CodeChroma.Bridge.Tests.Agents;

/// <summary>"Open agent" on a finished workflow step: a claude agent in the run worktree forking the step's session (019 Stage 5).</summary>
public sealed class OpenStepAgentTests
{
    private static StringContent Body(string json) => new(json, Encoding.UTF8, "application/json");

    [Fact]
    public void A_fork_launch_resumes_into_a_new_session()
    {
        var dir = Path.Combine(Path.GetTempPath(), "cc-fork-" + Guid.NewGuid().ToString("N")[..8]);
        var paths = UserPaths.Under(dir);
        var providers = new ProviderStore(paths);
        var agents = new TerminalAgents(paths, providers, new CallSiteStore(paths, providers));

        var argv = agents.Resolve("claude", "step-session", forkSession: true)!.Argv;

        Assert.Contains("--fork-session", argv);
        Assert.Equal(["--resume", "step-session"], argv.Skip(argv.Count - 2));
    }

    [Fact]
    public void A_plain_resume_does_not_fork()
    {
        var dir = Path.Combine(Path.GetTempPath(), "cc-fork-" + Guid.NewGuid().ToString("N")[..8]);
        var paths = UserPaths.Under(dir);
        var providers = new ProviderStore(paths);
        var agents = new TerminalAgents(paths, providers, new CallSiteStore(paths, providers));

        var argv = agents.Resolve("claude", "own-session")!.Argv;

        Assert.DoesNotContain("--fork-session", argv);
    }

    [Fact]
    public async Task Creating_with_a_run_and_session_opens_the_agent_in_the_run_worktree()
    {
        using var host = new BridgeHost();
        var worktree = Path.GetFullPath(WorkflowRunner.WorktreeFor(host.Root, "run1"));
        Directory.CreateDirectory(worktree);

        var response = await host.Client.PostAsync("/agents", Body("""{"title":"implement","kind":"claude","run_id":"run1","fork_session":"step-session"}"""));

        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        var agent = JsonNode.Parse(await response.Content.ReadAsStringAsync())!;
        Assert.Equal(worktree, (string?)agent["worktree"]);
        Assert.Equal("run1", (string?)agent["source_run"]);
        Assert.Equal("step-session", (string?)agent["fork_session"]);
    }

    [Fact]
    public void A_run_of_another_workspace_opens_in_that_workspace_worktree()
    {
        using var host = new BridgeHost();
        var other = Path.Combine(Path.GetTempPath(), "cc-other-" + Guid.NewGuid().ToString("N")[..8]);
        var worktree = Path.GetFullPath(WorkflowRunner.WorktreeFor(other, "run1"));
        Directory.CreateDirectory(worktree);

        var agent = host.Factory.Services.GetRequiredService<AgentManager>().CreateInRun("implement", "run1", "s1", other);

        Assert.Equal(worktree, agent.Worktree);
    }

    [Fact]
    public async Task A_run_without_a_worktree_is_a_404()
    {
        using var host = new BridgeHost();

        var response = await host.Client.PostAsync("/agents", Body("""{"kind":"claude","run_id":"gone","fork_session":"s1"}"""));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Theory]
    [InlineData("""{"kind":"shell","run_id":"run1","fork_session":"s1"}""")]
    [InlineData("""{"kind":"claude","run_id":"run1"}""")]
    [InlineData("""{"kind":"claude","fork_session":"s1"}""")]
    public async Task A_fork_needs_claude_and_both_fields(string json)
    {
        using var host = new BridgeHost();
        Directory.CreateDirectory(WorkflowRunner.WorktreeFor(host.Root, "run1"));

        var response = await host.Client.PostAsync("/agents", Body(json));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
