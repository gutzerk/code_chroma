using System.Net;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Tests.Support;

namespace CodeChroma.Bridge.Tests.Workspaces;

/// <summary>The last-viewed workspace (a PR review included) survives a restart so the canvas can reopen it.</summary>
public class ActiveWorkspaceTests : IDisposable
{
    private readonly GitSandbox _repo = new();

    public void Dispose() => _repo.Dispose();

    private static async Task<JsonObject> Body(HttpResponseMessage response) => (JsonObject)JsonNode.Parse(await response.Content.ReadAsStringAsync())!;

    [Fact]
    public async Task Activating_a_workspace_records_it_as_the_last_viewed_one()
    {
        using var host = new BridgeHost();
        var tab = (await Body(await host.Client.PostAsync("/branches/ensure", null)))["active"]!.GetValue<string>();

        var activated = await host.Client.PostAsync($"/workspaces/{tab}/activate", null);
        var agents = await Body(await host.Client.GetAsync("/agents"));
        var prs = await Body(await host.Client.GetAsync("/prs"));

        Assert.Equal(HttpStatusCode.OK, activated.StatusCode);
        Assert.Equal(tab, agents["active_workspace"]!.GetValue<string>());
        Assert.Equal(tab, prs["active_workspace"]!.GetValue<string>());
    }

    [Fact]
    public void A_remembered_pr_is_restored_after_a_restart_once_it_is_registered_again()
    {
        var before = new AgentManager(_repo.Root) { WorkspaceGuard = id => id == "pr-7" };
        before.SetActiveWorkspace("pr-7");
        var after = new AgentManager(_repo.Root) { WorkspaceGuard = id => id == "pr-7" };

        after.RevalidateActiveWorkspace();

        Assert.Equal("pr-7", after.ActiveWorkspace);
    }

    [Fact]
    public void A_remembered_pr_that_is_gone_falls_back_to_main_and_is_forgotten()
    {
        var before = new AgentManager(_repo.Root) { WorkspaceGuard = id => id == "pr-7" };
        before.SetActiveWorkspace("pr-7");
        var after = new AgentManager(_repo.Root);

        after.RevalidateActiveWorkspace();

        Assert.Equal("main", after.ActiveWorkspace);
        Assert.Equal("main", new AgentManager(_repo.Root).ActiveWorkspace);
    }
}
