using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Tests.Questions;
using CodeChroma.Bridge.Tests.Support;

namespace CodeChroma.Bridge.Tests.Agents;

/// <summary>POST /agents with `workflow_request` ("New workflow → With an agent") and the "workflows" ping a saved definition sends.</summary>
public sealed class WorkflowAgentRouteTests : IDisposable
{
    private readonly BridgeHost _host = new();

    public void Dispose() => _host.Dispose();

    private static StringContent Json(object body) => QuestionTestKit.JsonBody(System.Text.Json.JsonSerializer.SerializeToNode(body)!);

    private Task<string> Tab() => Terminal.TerminalSocketTests.EnsureTab(_host);

    [Fact]
    public async Task A_task_agent_keeps_the_workflow_request()
    {
        var tab = await Tab();

        var made = await QuestionTestKit.Body(await _host.Client.PostAsync("/agents", Json(new { title = "New workflow", workspace = tab, context = "x", context_kind = "task", workflow_request = "  plan then review  " })));

        Assert.Equal("plan then review", made["workflow_request"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("task", "x", "   ", null)]
    [InlineData("task", "x", "plan", "sequence")]
    [InlineData("view", "x", "plan then review", null)]
    [InlineData("task", null, "plan then review", null)]
    public async Task A_workflow_request_is_refused_unless_it_is_a_non_blank_task_launch_with_a_context_and_no_diagram_type(string contextKind, string? context, string request, string? diagramType)
    {
        var tab = await Tab();

        var response = await _host.Client.PostAsync("/agents", Json(new { title = "a", workspace = tab, context, context_kind = contextKind, workflow_request = request, diagram_type = diagramType }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Saving_a_workflow_pings_every_canvas()
    {
        var socket = await _host.Server.CreateWebSocketClient().ConnectAsync(new Uri("ws://localhost/repos/main/events"), CancellationToken.None);
        var definition = new { id = "wf", name = "Flow", steps = new[] { new { id = "s1", slug = "go", kind = "agent", prompt = "go" } } };

        await _host.Client.PostAsync("/repos/main/workflows", Json(definition));
        var ping = await Sockets.ReceiveUntil(socket, m => m.Contains("\"workflows\""));

        Assert.Contains("\"type\":\"workflows\"", ping);
    }
}
