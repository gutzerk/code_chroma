using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Workspaces;
using Microsoft.Extensions.DependencyInjection;
using static CodeChroma.Bridge.Tests.Questions.QuestionTestKit;

namespace CodeChroma.Bridge.Tests.Questions;

/// <summary>The agent window's question source: GET/POST /agents/{id}/questions, the `agent-questions` push and `open_questions` on GET /agents.</summary>
public sealed class AgentQuestionRoutesTests
{
    /// <summary>A tab plus a shell agent on it, so the agent shares the tab's workspace as an "Add agent here" agent does; returns (tab, agent id).</summary>
    private static async Task<(string Tab, string Agent)> AgentOnTab(BridgeHost host, string title = "Looker")
    {
        var tab = (string)(await Body(await host.Client.PostAsync("/branches/ensure", null)))["active"]!;
        var agent = await Body(await host.Client.PostAsync("/agents", JsonBody(new JsonObject { ["title"] = title, ["kind"] = "shell", ["workspace"] = tab })));
        return (tab, (string)agent["id"]!);
    }

    private static Workspace WorkspaceOf(BridgeHost host, string id) => host.Factory.Services.GetRequiredService<WorkspaceRegistry>().Get(id);

    /// <summary>Opens a question as `agentId` in the workspace `into` asks into (default: the agent's own); returns its question id.</summary>
    private static string Ask(BridgeHost host, string agentId, AskRequest request, string? into = null)
    {
        request.AgentId = agentId;
        var id = Guid.NewGuid().ToString("N");
        QuestionStore.OpenQuestion(WorkspaceOf(host, into ?? agentId), request, id);
        return id;
    }

    [Fact]
    public async Task Reads_the_agents_open_question_history_and_option_diagram_from_the_workspace_it_shares()
    {
        using var host = new BridgeHost();
        var (tab, agent) = await AgentOnTab(host);
        var earlier = Ask(host, agent, Request(question: "Earlier?", sessionId: "s1"));
        await host.Client.PostAsync($"/repos/{tab}/questions/{earlier}/answer", JsonBody(new JsonObject { ["option_id"] = "a" }));
        var current = Ask(host, agent, Request(question: "Now?", sessionId: "s1"));
        Ask(host, "someone-else", Request(question: "Not mine?"), into: agent);
        var root = QuestionStore.DrawDiagram(WorkspaceOf(host, agent), "Option A", [new DiagramNode("api", "API"), new DiagramNode("db", "DB")], [new DiagramEdge("api", "db")], current, "a");

        var body = await Body(await host.Client.GetAsync($"/agents/{agent}/questions"));

        var labels = body["elements"]!.AsObject().Select(p => (string?)p.Value!["label"]).ToList();
        Assert.Equal((agent, tab, 1), ((string?)body["agent_id"], (string?)body["workspace"], (int)body["open_questions"]!));
        Assert.Contains("Now?", labels);
        Assert.Contains("Earlier?", labels);
        Assert.DoesNotContain("Not mine?", labels);
        Assert.Contains(root, body["elements"]!.AsObject().Select(p => p.Key));
        Assert.Contains("API", labels);
        Assert.Single(body["edges"]!.AsObject());
    }

    [Fact]
    public async Task A_neighbours_settled_question_in_the_same_session_is_not_in_the_agents_history()
    {
        using var host = new BridgeHost();
        var (tab, agent) = await AgentOnTab(host);
        var theirs = Ask(host, "someone-else", Request(question: "Their earlier?", sessionId: "s1"), into: agent);
        await host.Client.PostAsync($"/repos/{tab}/questions/{theirs}/answer", JsonBody(new JsonObject { ["option_id"] = "a" }));
        Ask(host, agent, Request(question: "Now?", sessionId: "s1"));

        var body = await Body(await host.Client.GetAsync($"/agents/{agent}/questions"));

        var labels = body["elements"]!.AsObject().Select(p => (string?)p.Value!["label"]).ToList();
        Assert.Equal(["Now?"], labels);
    }

    [Fact]
    public async Task An_unknown_agent_is_a_404_on_read_and_every_write()
    {
        using var host = new BridgeHost();

        var statuses = new[]
        {
            (await host.Client.GetAsync("/agents/nope/questions")).StatusCode,
            (await host.Client.PostAsync("/agents/nope/questions/q1/answer", JsonBody(new JsonObject { ["answer"] = "x" }))).StatusCode,
            (await host.Client.PostAsync("/agents/nope/questions/q1/skip", null)).StatusCode,
            (await host.Client.PostAsync("/agents/nope/questions/q1/revise", null)).StatusCode,
            (await host.Client.PostAsync("/agents/nope/questions/q1/request-diagram", null)).StatusCode,
        };

        Assert.All(statuses, status => Assert.Equal(HttpStatusCode.NotFound, status));
    }

    [Fact]
    public async Task Writes_by_agent_id_settle_its_question_in_the_shared_workspace_and_never_a_neighbours()
    {
        using var host = new BridgeHost();
        var (_, agent) = await AgentOnTab(host);
        var mine = Ask(host, agent, Request(sessionId: "s1"));
        var theirs = Ask(host, "someone-else", Request(), into: agent);

        var answered = await Body(await host.Client.PostAsync($"/agents/{agent}/questions/{mine}/answer", JsonBody(new JsonObject { ["option_id"] = "b" })));
        var foreign = await host.Client.PostAsync($"/agents/{agent}/questions/{theirs}/skip", null);
        var revised = await Body(await host.Client.PostAsync($"/agents/{agent}/questions/{mine}/revise", null));
        var requested = await host.Client.PostAsync($"/agents/{agent}/questions/{mine}/request-diagram", null);
        var skipped = await Body(await host.Client.PostAsync($"/agents/{agent}/questions/{mine}/skip", null));

        Assert.Equal(("answered", "Microservices"), ((string?)answered["state"], (string?)answered["answer"]));
        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
        Assert.Equal("open", (string?)revised["state"]);
        Assert.Equal(HttpStatusCode.OK, requested.StatusCode);
        Assert.Equal("skipped", (string?)skipped["state"]);
        Assert.Equal("open", (string?)QuestionStore.FindElement(WorkspaceOf(host, agent), theirs)!.Meta["state"]);
    }

    [Fact]
    public async Task Get_agents_carries_each_agents_open_question_count()
    {
        using var host = new BridgeHost();
        var (_, agent) = await AgentOnTab(host);
        Ask(host, agent, Request());
        Ask(host, agent, Request(question: "Second?"));

        var listed = await Body(await host.Client.GetAsync("/agents"));

        var row = listed["agents"]!.AsArray().Single(a => (string?)a!["id"] == agent)!;
        Assert.Equal(2, (int)row["open_questions"]!);
    }

    [Fact]
    public async Task Answering_and_asking_push_agent_questions_with_the_open_count()
    {
        using var host = new BridgeHost(configure: services => services.AddSingleton(sp => new QuestionMcp(
            id => sp.GetRequiredService<WorkspaceRegistry>().Get(id), attachedWindows: _ => 1,
            questionsChanged: id => sp.GetRequiredService<AgentQuestionEvents>().Changed(id))));
        var (_, agent) = await AgentOnTab(host);
        var question = Ask(host, agent, Request());
        using var socket = await host.Server.CreateWebSocketClient().ConnectAsync(new Uri("ws://localhost/repos/main/events"), CancellationToken.None);

        await host.Client.PostAsync($"/agents/{agent}/questions/{question}/answer", JsonBody(new JsonObject { ["option_id"] = "a" }));
        var answered = await NextQuestionEvent(socket);
        await Mcp(host).Ask(agent, Request(question: "Next?"));
        var asked = await NextQuestionEvent(socket);

        Assert.Equal((agent, 0), ((string?)answered["id"], (int)answered["open_questions"]!));
        Assert.Equal((agent, 1), ((string?)asked["id"], (int)asked["open_questions"]!));
    }

    /// <summary>The next `agent-questions` frame, skipping canvas pings and other events.</summary>
    private static async Task<JsonObject> NextQuestionEvent(WebSocket socket)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        var buffer = new byte[64 * 1024];
        while (true)
        {
            var result = await socket.ReceiveAsync(buffer, timeout.Token);
            var frame = (JsonObject)JsonNode.Parse(Encoding.UTF8.GetString(buffer, 0, result.Count))!;
            if ((string?)frame["type"] == AgentQuestionEvents.Type) return frame;
        }
    }
}
