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

    private async Task<string> Tab() => (await QuestionTestKit.Body(await _host.Client.PostAsync("/branches/ensure", null)))["branches"]![0]!["id"]!.GetValue<string>();

    [Fact]
    public async Task A_task_agent_keeps_the_workflow_request()
    {
        var tab = await Tab();

        var made = await QuestionTestKit.Body(await _host.Client.PostAsync("/agents", Json(new { title = "New workflow", workspace = tab, context = "x", context_kind = "task", workflow_request = "  plan then review  " })));

        Assert.Equal("plan then review", made["workflow_request"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("   ", null)]
    [InlineData("plan", "sequence")]
    public async Task A_blank_workflow_request_or_one_with_a_diagram_type_is_refused(string request, string? diagramType)
    {
        var tab = await Tab();

        var response = await _host.Client.PostAsync("/agents", Json(new { title = "a", workspace = tab, context = "x", context_kind = "task", workflow_request = request, diagram_type = diagramType }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Saving_a_workflow_pings_every_canvas()
    {
        var socket = await _host.Server.CreateWebSocketClient().ConnectAsync(new Uri("ws://localhost/repos/main/events"), CancellationToken.None);
        var definition = new { id = "wf", name = "Flow", steps = new[] { new { id = "s1", slug = "go", kind = "agent", prompt = "go" } } };

        await _host.Client.PostAsync("/repos/main/workflows", Json(definition));
        var seen = new List<string>();
        var buffer = new byte[8192];
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        while (!seen.Any(m => m.Contains("\"workflows\"")))
        {
            var result = await socket.ReceiveAsync(buffer, timeout.Token);
            seen.Add(Encoding.UTF8.GetString(buffer, 0, result.Count));
        }

        Assert.Contains(seen, m => m.Contains("\"type\":\"workflows\""));
    }
}
