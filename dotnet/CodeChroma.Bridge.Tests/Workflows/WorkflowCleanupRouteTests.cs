using System.Net;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Workflows;
using CodeChroma.Bridge.Workspaces;
using Microsoft.Extensions.DependencyInjection;

namespace CodeChroma.Bridge.Tests.Workflows;

/// <summary>Run cleanup protects attached agents and reserves the worktree against concurrent opens.</summary>
public sealed class WorkflowCleanupRouteTests
{
    [Theory]
    [InlineData("delete")]
    [InlineData("restart")]
    [InlineData("clear")]
    public async Task Cleanup_keeps_an_attached_agents_worktree_and_run(string operation)
    {
        using var host = new BridgeHost();
        var store = new RunStore(host.Root);
        store.SaveWorkflow(new WorkflowDef { Id = "wf", Name = "Flow", Steps = [new WorkflowStep { Id = "one", Slug = "one", Prompt = "go" }] });
        store.Save(new Run { Id = "run1", WorkflowId = "wf", State = RunStates.Done });
        store.Save(new Run { Id = "run2", WorkflowId = "wf", State = RunStates.Done });
        var worktree = WorkflowRunner.WorktreeFor(host.Root, "run1");
        Directory.CreateDirectory(worktree);
        var edit = Path.Combine(worktree, "interactive-edit.txt");
        File.WriteAllText(edit, "keep this edit");
        var agents = host.Factory.Services.GetRequiredService<AgentManager>();
        var agent = agents.CreateInRun("Opened step", "run1", "session");
        agents.MarkStarted(agent.Id, 123);

        var response = operation switch
        {
            "delete" => await host.Client.DeleteAsync("/repos/main/runs/run1"),
            "restart" => await host.Client.PostAsync("/repos/main/runs/run1/restart", null),
            _ => await host.Client.DeleteAsync("/repos/main/runs?state=finished"),
        };
        var body = await response.Content.ReadAsStringAsync();

        Assert.Equal(operation == "clear" ? HttpStatusCode.OK : HttpStatusCode.Conflict, response.StatusCode);
        Assert.NotNull(store.GetRun("run1"));
        Assert.Equal("keep this edit", File.ReadAllText(edit));
        Assert.Equal(AgentRecord.StatusRunning, agents.Get(agent.Id).Status);
        if (operation == "clear")
        {
            Assert.Equal("run2", (string?)JsonNode.Parse(body)!["deleted"]![0]);
            Assert.Null(store.GetRun("run2"));
        }
    }

    [Fact]
    public async Task Closing_the_attached_agent_allows_run_deletion()
    {
        using var host = new BridgeHost();
        var store = new RunStore(host.Root);
        store.Save(new Run { Id = "run1", WorkflowId = "wf", State = RunStates.Done });
        var worktree = WorkflowRunner.WorktreeFor(host.Root, "run1");
        Directory.CreateDirectory(worktree);
        var agents = host.Factory.Services.GetRequiredService<AgentManager>();
        var agent = agents.CreateInRun("Opened step", "run1", "session");
        agents.Delete(agent.Id);

        var response = await host.Client.DeleteAsync("/repos/main/runs/run1");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Null(store.GetRun("run1"));
        Assert.False(Directory.Exists(worktree));
    }

    [Fact]
    public void An_agent_cannot_open_during_cleanup_and_can_open_after_a_failed_cleanup_releases_its_reservation()
    {
        using var repo = new GitSandbox();
        var agents = new AgentManager(repo.Root);
        var worktree = WorkflowRunner.WorktreeFor(repo.Root, "run1");
        Directory.CreateDirectory(worktree);

        Exception? blocked;
        using (agents.ReserveRunCleanup(worktree))
            blocked = Record.Exception(() => agents.CreateInRun("Opened step", "run1", "session"));
        var agent = agents.CreateInRun("Opened step", "run1", "session");

        Assert.Equal(409, Assert.IsType<BridgeException>(blocked).Status);
        Assert.Equal(worktree, agent.Worktree);
    }
}
