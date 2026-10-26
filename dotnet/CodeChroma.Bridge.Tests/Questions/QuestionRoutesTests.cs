using System.Net;
using System.Net.Http.Headers;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Tests.Support;
using static CodeChroma.Bridge.Tests.Questions.QuestionTestKit;

namespace CodeChroma.Bridge.Tests.Questions;

/// <summary>Routes for /repos/{id}/questions plus the MCP tool bodies, over a real workspace on disk.</summary>
public sealed class QuestionRoutesTests
{
    [Fact]
    public async Task Open_question_writes_a_question_element_with_the_documented_meta()
    {
        using var host = new BridgeHost();
        var questionId = Open(host, Request(sessionId: "s1", total: 3));

        var canvas = await Body(await host.Client.GetAsync("/repos/main/canvas"));

        var element = canvas["elements"]!.AsObject().Select(p => p.Value!.AsObject()).Single(e => (string?)e["render"] == "question");
        Assert.Equal("How to structure checkout?", (string?)element["label"]);
        Assert.Equal("questions", (string?)element["layer"]);
        var meta = element["meta"]!.AsObject();
        Assert.Equal(questionId, (string?)meta["question_id"]);
        Assert.Equal("open", (string?)meta["state"]);
        Assert.Equal((1, 3), ((int)meta["step"]!, (int)meta["total"]!));
        Assert.Equal("Modular monolith", (string?)meta["options"]![0]!["title"]);
        Assert.False(Directory.Exists(Path.Combine(host.Root, ".codechroma", "diagrams", "questions")));
    }

    [Fact]
    public void A_second_question_in_a_session_gets_the_next_step()
    {
        using var host = new BridgeHost();
        Open(host, Request(sessionId: "s1"));

        var second = Open(host, Request(sessionId: "s1"));

        Assert.Equal(2, (int)QuestionStore.FindElement(Main(host), second)!.Meta["step"]!);
    }

    [Fact]
    public async Task Get_questions_lists_open_ones_as_not_waiting_without_a_live_waiter()
    {
        using var host = new BridgeHost();
        var questionId = Open(host, Request());

        var body = await Body(await host.Client.GetAsync("/repos/main/questions"));

        var only = Assert.Single(body["questions"]!.AsArray());
        Assert.Equal(questionId, (string?)only!["question_id"]);
        Assert.False((bool)only["waiting"]!);
        Assert.Equal("How to structure checkout?", (string?)only["question"]);
    }

    [Fact]
    public async Task Answer_with_an_option_records_its_title_on_the_element()
    {
        using var host = new BridgeHost();
        var questionId = Open(host, Request());

        var response = await host.Client.PostAsync($"/repos/main/questions/{questionId}/answer", JsonBody(new JsonObject { ["option_id"] = "a" }));
        var listed = await Body(await host.Client.GetAsync("/repos/main/questions"));

        var element = QuestionStore.FindElement(Main(host), questionId)!;
        Assert.Equal($$"""{"ok":true,"question_id":"{{questionId}}","state":"answered","waiting":false,"answer":"Modular monolith"}""", (await Body(response)).ToJsonString());
        Assert.Equal("answered", (string?)element.Meta["state"]);
        Assert.Equal(("Modular monolith", "a"), ((string?)element.Meta["answer"], (string?)element.Meta["option_id"]));
        Assert.Empty(listed["questions"]!.AsArray());
    }

    [Fact]
    public async Task A_custom_answer_is_accepted_and_empty_or_unknown_option_is_refused()
    {
        using var host = new BridgeHost();
        var questionId = Open(host, Request());
        var url = $"/repos/main/questions/{questionId}/answer";

        var empty = await host.Client.PostAsync(url, JsonBody(new JsonObject { ["answer"] = "  " }));
        var unknown = await host.Client.PostAsync(url, JsonBody(new JsonObject { ["option_id"] = "zzz" }));
        var custom = await host.Client.PostAsync(url, JsonBody(new JsonObject { ["answer"] = "event sourcing" }));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, empty.StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, unknown.StatusCode);
        Assert.Equal(HttpStatusCode.OK, custom.StatusCode);
        Assert.Equal("event sourcing", (string?)QuestionStore.FindElement(Main(host), questionId)!.Meta["answer"]);
    }

    [Fact]
    public async Task A_custom_answer_is_refused_when_not_allowed()
    {
        using var host = new BridgeHost();
        var questionId = Open(host, Request(allowCustom: false));

        var response = await host.Client.PostAsync($"/repos/main/questions/{questionId}/answer", JsonBody(new JsonObject { ["answer"] = "mine" }));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    [Fact]
    public async Task Skip_marks_the_element_skipped_and_a_second_settle_conflicts()
    {
        using var host = new BridgeHost();
        var questionId = Open(host, Request());

        var first = await host.Client.PostAsync($"/repos/main/questions/{questionId}/skip", null);
        var again = await host.Client.PostAsync($"/repos/main/questions/{questionId}/skip", null);

        Assert.True((bool)(await Body(first))["ok"]!);
        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
        Assert.Equal("skipped", (string?)QuestionStore.FindElement(Main(host), questionId)!.Meta["state"]);
    }

    [Fact]
    public async Task Skip_is_refused_when_not_allowed_and_an_unknown_question_is_404()
    {
        using var host = new BridgeHost();
        var questionId = Open(host, Request(allowSkip: false));

        var refused = await host.Client.PostAsync($"/repos/main/questions/{questionId}/skip", null);
        var missing = await host.Client.PostAsync("/repos/main/questions/nope/skip", null);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, refused.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Fact]
    public async Task The_answer_route_wakes_a_blocked_ask()
    {
        using var host = new BridgeHost();
        var mcp = Mcp(host);
        var ask = mcp.Ask("main", Request(question: "Pick"));
        await WaitUntilWaiting(host, mcp);
        var questionId = (string)QuestionStore.ListQuestions(Main(host))[0].Meta["question_id"]!;

        var reply = await Body(await host.Client.PostAsync($"/repos/main/questions/{questionId}/answer", JsonBody(new JsonObject { ["option_id"] = "b" })));
        var result = await ask.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.True((bool)reply["waiting"]!);
        Assert.Equal("answered", (string?)reply["state"]);
        Assert.Equal("""{"answer":"Microservices","option_id":"b","skipped":false}""", result.ToJsonString());
    }

    [Fact]
    public async Task Ask_returns_pending_on_timeout_and_result_fetches_the_later_answer()
    {
        using var host = new BridgeHost();
        var mcp = Mcp(host);
        mcp.AskWait = TimeSpan.FromMilliseconds(50);

        var pending = await mcp.Ask("main", Request(question: "Pick"));
        mcp.Broker.Answer((string)pending["question_id"]!, "late");
        var later = await mcp.Result("main", (string)pending["question_id"]!);

        Assert.True((bool)pending["pending"]!);
        Assert.Equal("""{"answer":"late","option_id":null,"skipped":false}""", later.ToJsonString());
    }

    [Fact]
    public async Task Result_reads_the_element_when_the_broker_forgot_it()
    {
        using var host = new BridgeHost();
        var questionId = Open(host, Request());
        await host.Client.PostAsync($"/repos/main/questions/{questionId}/skip", null);
        Mcp(host).Broker.Forget(questionId);

        var result = await Mcp(host).Result("main", questionId);

        Assert.Equal("""{"answer":null,"option_id":null,"skipped":true}""", result.ToJsonString());
    }

    [Fact]
    public void A_token_names_its_workspace_and_a_forged_one_is_refused()
    {
        using var host = new BridgeHost();
        var mcp = Mcp(host);
        var token = mcp.TokenFor("main");

        Assert.Equal("main", mcp.WorkspaceIdFor(token));
        foreach (var forged in new[] { token + "0", "main.deadbeef", "", null })
            Assert.Throws<QuestionAuthException>(() => mcp.WorkspaceIdFor(forged));
    }

    [Fact]
    public async Task Revise_reopens_the_question_and_deletes_later_steps_of_its_session()
    {
        using var host = new BridgeHost();
        var first = Open(host, Request(sessionId: "s1"));
        var second = Open(host, Request(sessionId: "s1"));
        await host.Client.PostAsync($"/repos/main/questions/{first}/answer", JsonBody(new JsonObject { ["option_id"] = "a" }));
        await host.Client.PostAsync($"/repos/main/questions/{second}/answer", JsonBody(new JsonObject { ["option_id"] = "b" }));

        var response = await Body(await host.Client.PostAsync($"/repos/main/questions/{first}/revise", null));

        var reopened = QuestionStore.FindElement(Main(host), first)!;
        Assert.Equal("open", (string?)response["state"]);
        Assert.Single(response["removed"]!.AsArray());
        Assert.Equal("open", (string?)reopened.Meta["state"]);
        Assert.Null(reopened.Meta["answer"]);
        Assert.Null(QuestionStore.FindElement(Main(host), second));
        Assert.Equal("questions", reopened.Layer);
    }

    [Fact]
    public async Task Request_diagram_marks_the_element_and_counts_the_request()
    {
        using var host = new BridgeHost();
        var questionId = Open(host, Request());

        var response = await Body(await host.Client.PostAsync($"/repos/main/questions/{questionId}/request-diagram", null));

        var meta = QuestionStore.FindElement(Main(host), questionId)!.Meta;
        Assert.Equal("open", (string?)response["state"]);
        Assert.True((bool)meta["diagram_requested"]!);
        Assert.Equal(1, (int)meta["diagram_requests"]!);
        Assert.False(string.IsNullOrEmpty((string?)meta["diagram_requested_at"]));
    }

    [Fact]
    public async Task Request_diagram_is_refused_when_every_option_has_a_diagram()
    {
        using var host = new BridgeHost();
        var questionId = Open(host, Request([Question(1, "x"), Question(2, "x")]));

        var response = await host.Client.PostAsync($"/repos/main/questions/{questionId}/request-diagram", null);

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }

    private static QuestionOption Question(int rank, string diagramRef) => Option(rank == 1 ? "a" : "b", rank, diagramRef: diagramRef);

    [Fact]
    public async Task Request_diagram_hands_needs_to_the_blocked_ask()
    {
        using var host = new BridgeHost();
        var mcp = Mcp(host);
        var ask = mcp.Ask("main", Request(question: "Pick"));
        await WaitUntilWaiting(host, mcp);
        var questionId = (string)QuestionStore.ListQuestions(Main(host))[0].Meta["question_id"]!;

        await host.Client.PostAsync($"/repos/main/questions/{questionId}/request-diagram", null);
        var result = await ask.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.Equal($$"""{"needs":"diagram","question_id":"{{questionId}}"}""", result.ToJsonString());
    }

    [Fact]
    public async Task Repeated_request_diagram_clicks_count_once_and_report_no_waiter()
    {
        using var host = new BridgeHost();
        var questionId = Open(host, Request());
        var url = $"/repos/main/questions/{questionId}/request-diagram";

        var first = await Body(await host.Client.PostAsync(url, null));
        var second = await Body(await host.Client.PostAsync(url, null));

        Assert.Equal(1, (int)QuestionStore.FindElement(Main(host), questionId)!.Meta["diagram_requests"]!);
        Assert.False((bool)first["waiting"]!);
        Assert.False((bool)second["waiting"]!);
    }

    [Fact]
    public void Find_diagram_requested_ignores_an_unrelated_ask_from_another_session()
    {
        using var host = new BridgeHost();
        var questionId = Open(host, Request(sessionId: "s1"));
        QuestionStore.RequestDiagram(Main(host), QuestionStore.FindElement(Main(host), questionId)!, "now");

        Assert.Null(QuestionStore.FindDiagramRequested(Main(host), Request(question: "Unrelated?", sessionId: "s2")));
    }

    [Fact]
    public void Find_diagram_requested_ignores_a_different_text_without_a_session()
    {
        using var host = new BridgeHost();
        var questionId = Open(host, Request());
        QuestionStore.RequestDiagram(Main(host), QuestionStore.FindElement(Main(host), questionId)!, "now");

        Assert.Null(QuestionStore.FindDiagramRequested(Main(host), new AskRequest { Question = "Other?" }));
    }

    [Fact]
    public void Find_diagram_requested_returns_the_newest_card_and_its_older_duplicates()
    {
        using var host = new BridgeHost();
        var old = Open(host, Request(sessionId: "s1"));
        var fresh = Open(host, Request(sessionId: "s1"));
        foreach (var id in new[] { old, fresh }) QuestionStore.RequestDiagram(Main(host), QuestionStore.FindElement(Main(host), id)!, "now");

        var (keep, stale) = QuestionStore.FindDiagramRequested(Main(host), Request(sessionId: "s1"))!.Value;

        Assert.Equal(fresh, (string?)keep.Meta["question_id"]);
        Assert.Equal([old], stale.Select(e => (string?)e.Meta["question_id"]));
    }

    [Fact]
    public void Reask_skips_stale_duplicates_and_refreshes_label_and_meta()
    {
        using var host = new BridgeHost();
        var ws = Main(host);
        var old = Open(host, Request(sessionId: "s1"));
        var fresh = Open(host, Request(sessionId: "s1"));
        foreach (var id in new[] { old, fresh }) QuestionStore.RequestDiagram(ws, QuestionStore.FindElement(ws, id)!, "now");
        QuestionStore.Reask(ws, QuestionStore.FindElement(ws, fresh)!, new AskRequest { Question = "Q1?" }, new JsonObject { ["degraded"] = true, ["validation"] = "bad" });

        QuestionStore.Reask(ws, QuestionStore.FindElement(ws, fresh)!, Request(question: "Reworded?", sessionId: "s1"), null, [QuestionStore.FindElement(ws, old)!]);

        var element = QuestionStore.FindElement(ws, fresh)!;
        Assert.Equal("Reworded?", element.Label);
        Assert.False((bool)element.Meta["degraded"]!);
        Assert.Null(element.Meta["validation"]);
        Assert.Equal("skipped", (string?)QuestionStore.FindElement(ws, old)!.Meta["state"]);
    }

    [Fact]
    public async Task Ask_stamps_the_authenticated_workspace_as_agent_id()
    {
        using var host = new BridgeHost();
        var mcp = Mcp(host);
        using var cancel = new CancellationTokenSource();
        var request = Request(question: "Pick");
        request.AgentId = "spoofed";
        var ask = mcp.Ask("main", request, cancellation: cancel.Token);
        await WaitUntilWaiting(host, mcp);

        await cancel.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => ask);

        Assert.Equal("main", (string?)QuestionStore.ListQuestions(Main(host))[0].Meta["agent_id"]);
    }

    [Fact]
    public async Task Draw_diagram_bands_do_not_overlap_after_a_diagram_is_deleted()
    {
        using var host = new BridgeHost();
        var ws = Main(host);
        DiagramNode[] nodes = [new("a", "a")];
        var roots = new[] { QuestionStore.DrawDiagram(ws, "T", nodes, [], null, null), QuestionStore.DrawDiagram(ws, "T", nodes, [], null, null) };
        var patch = new JsonObject { ["ops"] = new JsonArray(new JsonObject { ["op"] = "delete_element", ["id"] = roots[0] }) };
        await host.Client.PatchAsync("/repos/main/canvas", JsonBody(patch));

        var third = QuestionStore.DrawDiagram(ws, "T", nodes, [], null, null);

        var doc = CanvasDoc.Load(ws.CanvasCorePath(), ws.DiagramsRoot());
        Assert.True(doc.Elements[third].Position.Y > doc.Elements[roots[1]].Position.Y);
    }

    [Fact]
    public void Draw_diagram_with_an_unknown_option_leaves_no_orphan_diagram()
    {
        using var host = new BridgeHost();
        var questionId = Open(host, Request());

        Assert.Throws<QuestionWriteException>(() => QuestionStore.DrawDiagram(Main(host), "T", [new DiagramNode("a", "a")], [], questionId, "nope"));

        var doc = CanvasDoc.Load(Main(host).CanvasCorePath(), Main(host).DiagramsRoot());
        Assert.DoesNotContain(doc.Elements.Values, e => Json.Truthy(e.Meta["diagram_root"]));
    }

    private static HttpRequestMessage Rpc(string? token, JsonObject body, string path = "/mcp/")
    {
        var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonBody(body) };
        if (token is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return request;
    }

    private static JsonObject Call(int id, string tool, JsonObject arguments) => new()
    {
        ["jsonrpc"] = "2.0", ["id"] = id, ["method"] = "tools/call", ["params"] = new JsonObject { ["name"] = tool, ["arguments"] = arguments },
    };

    [Fact]
    public async Task The_mcp_endpoint_refuses_a_missing_or_forged_token()
    {
        using var host = new BridgeHost();
        var ping = new JsonObject { ["jsonrpc"] = "2.0", ["id"] = 1, ["method"] = "ping" };

        var missing = await host.Client.SendAsync(Rpc(null, ping));
        var forged = await host.Client.SendAsync(Rpc("main.deadbeef", ping));

        Assert.Equal(HttpStatusCode.Unauthorized, missing.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, forged.StatusCode);
    }

    [Fact]
    public async Task The_mcp_endpoint_initializes_with_a_session_header_lists_tools_and_acks_notifications()
    {
        using var host = new BridgeHost();
        var token = Mcp(host).TokenFor("main");

        var init = await host.Client.SendAsync(Rpc(token, new JsonObject { ["jsonrpc"] = "2.0", ["id"] = 1, ["method"] = "initialize", ["params"] = new JsonObject { ["protocolVersion"] = "2025-03-26" } }));
        var tools = await Body(await host.Client.SendAsync(Rpc(token, new JsonObject { ["jsonrpc"] = "2.0", ["id"] = 2, ["method"] = "tools/list" })));
        var note = await host.Client.SendAsync(Rpc(token, new JsonObject { ["jsonrpc"] = "2.0", ["method"] = "notifications/initialized" }));
        var stream = await host.Client.GetAsync("/mcp/");

        var initBody = await Body(init);
        Assert.True(init.Headers.Contains("Mcp-Session-Id"));
        Assert.Equal("codechroma", (string?)initBody["result"]!["serverInfo"]!["name"]);
        Assert.Contains("ask_user", (string?)initBody["result"]!["instructions"]);
        Assert.Equal(["ask_user", "ask_user_result", "draw_option_diagram"], tools["result"]!["tools"]!.AsArray().Select(t => (string?)t!["name"]).ToArray());
        Assert.Equal(HttpStatusCode.Accepted, note.StatusCode);
        Assert.Equal(HttpStatusCode.MethodNotAllowed, stream.StatusCode);
    }

    [Fact]
    public async Task An_incomplete_ask_user_call_is_a_tool_error_and_creates_no_question()
    {
        using var host = new BridgeHost();
        var token = Mcp(host).TokenFor("main");
        var arguments = new JsonObject { ["question"] = "Q?", ["options"] = new JsonArray(new JsonObject { ["id"] = "a", ["title"] = "A" }) };

        var response = await Body(await host.Client.SendAsync(Rpc(token, Call(3, "ask_user", arguments))));

        var result = response["result"]!;
        Assert.True((bool)result["isError"]!);
        Assert.StartsWith("CodeChroma rejected the question.", (string?)result["content"]![0]!["text"]);
        Assert.Empty(QuestionStore.ListQuestions(Main(host)));
    }

    [Fact]
    public async Task Ask_user_over_http_blocks_until_the_canvas_answers()
    {
        using var host = new BridgeHost();
        var mcp = Mcp(host);
        var arguments = new JsonObject { ["question"] = "Pick", ["options"] = new JsonArray(Two().Select(o => (JsonNode?)o.ToJson()).ToArray()) };
        var call = host.Client.SendAsync(Rpc(mcp.TokenFor("main"), Call(4, "ask_user", arguments)));
        await WaitUntilWaiting(host, mcp);
        var questionId = (string)QuestionStore.ListQuestions(Main(host))[0].Meta["question_id"]!;

        await host.Client.PostAsync($"/repos/main/questions/{questionId}/answer", JsonBody(new JsonObject { ["option_id"] = "a" }));
        var response = await Body(await call.WaitAsync(TimeSpan.FromSeconds(5)));

        var structured = response["result"]!["structuredContent"]!;
        Assert.Equal("Modular monolith", (string?)structured["answer"]);
        Assert.Equal("a", (string?)structured["option_id"]);
        Assert.False((bool)response["result"]!["isError"]!);
    }

    [Fact]
    public async Task Draw_option_diagram_over_http_returns_a_ref_that_a_diagram_question_accepts()
    {
        using var host = new BridgeHost();
        var mcp = Mcp(host);
        mcp.AskWait = TimeSpan.FromMilliseconds(50);
        var token = mcp.TokenFor("main");
        var draw = new JsonObject
        {
            ["title"] = "Option A",
            ["nodes"] = new JsonArray(new JsonObject { ["id"] = "api", ["label"] = "API" }, new JsonObject { ["id"] = "q", ["label"] = "Queue", ["status"] = "new" }),
            ["edges"] = new JsonArray(new JsonObject { ["from"] = "api", ["to"] = "q" }),
        };

        var drawn = await Body(await host.Client.SendAsync(Rpc(token, Call(5, "draw_option_diagram", draw))));
        var diagramRef = (string)drawn["result"]!["structuredContent"]!["diagram_ref"]!;
        var result = await mcp.Ask("main", Request([Option("a", 1, diagramRef: diagramRef), Option("b", 2)], kind: "diagram"));

        var doc = CanvasDoc.Load(Main(host).CanvasCorePath(), Main(host).DiagramsRoot());
        var members = doc.Elements.Values.Where(e => e.GroupId == diagramRef).ToList();
        Assert.True((bool)result["pending"]!);
        Assert.All(members, e => Assert.Equal("decisions", e.Layer));
        Assert.Equal(["API", "Queue"], members.Select(e => e.Label!).Order().ToArray());
        Assert.Equal("new", (string?)members.Single(e => e.Label == "Queue").Meta["status"]);
        Assert.Single(doc.Edges);
    }

    [Fact]
    public async Task Draw_diagram_over_the_node_budget_or_with_an_empty_title_is_rejected()
    {
        using var host = new BridgeHost();
        var mcp = Mcp(host);
        var many = Enumerable.Range(0, QuestionDiagrams.MaxNodes + 1).Select(i => new DiagramNode(i.ToString(), "n")).ToList();

        await Assert.ThrowsAsync<QuestionRejected>(() => mcp.DrawDiagram("main", "T", many, [], null, null));
        var empty = await Assert.ThrowsAsync<QuestionRejected>(() => mcp.DrawDiagram("main", "  ", [new DiagramNode("a", "a")], [], null, null));
        Assert.Contains("title is empty", empty.Message);
    }

    [Fact]
    public async Task Draw_diagram_attaches_the_ref_to_the_question_option()
    {
        using var host = new BridgeHost();
        var questionId = Open(host, Request());

        var root = await Mcp(host).DrawDiagram("main", "T", [new DiagramNode("a", "a")], [], questionId, "b");

        var options = QuestionStore.FindElement(Main(host), questionId)!.Meta["options"]!.AsArray();
        Assert.Equal([null, (string?)root["diagram_ref"]], options.Select(o => (string?)o!["diagram_ref"]).ToArray());
    }

    [Fact]
    public async Task A_reask_after_a_diagram_request_updates_the_same_element()
    {
        using var host = new BridgeHost();
        var mcp = Mcp(host);
        mcp.AskWait = TimeSpan.FromMilliseconds(50);
        await mcp.Ask("main", Request(sessionId: "s"));
        var element = QuestionStore.ListQuestions(Main(host)).Single();
        QuestionStore.RequestDiagram(Main(host), element, "now");
        var drawn = await mcp.DrawDiagram("main", "T", [new DiagramNode("a", "a")], [], null, null);
        var options = new List<QuestionOption> { Option("a", 1, diagramRef: (string)drawn["diagram_ref"]!), Option("b", 2) };

        await mcp.Ask("main", Request(options, sessionId: "s", kind: "diagram"));

        var questions = QuestionStore.ListQuestions(Main(host));
        Assert.Equal([element.Id], questions.Select(q => q.Id));
        Assert.Equal((string)drawn["diagram_ref"]!, (string?)questions[0].Meta["options"]![0]!["diagram_ref"]);
        Assert.False((bool)questions[0].Meta["diagram_requested"]!);
    }

    [Fact]
    public async Task An_ask_with_an_unknown_diagram_ref_is_rejected()
    {
        using var host = new BridgeHost();

        var rejected = await Assert.ThrowsAsync<QuestionRejected>(() => Mcp(host).Ask("main", Request([Option("a", 1, diagramRef: "ghost"), Option("b", 2)])));

        Assert.Contains("ghost", rejected.Message);
    }

    [Fact]
    public async Task The_fourth_incomplete_ask_is_accepted_degraded()
    {
        using var host = new BridgeHost();
        var mcp = Mcp(host);
        mcp.AskWait = TimeSpan.FromMilliseconds(50);
        var bad = new AskRequest { Question = "Q?", SessionId = "s", Options = [new QuestionOption { Id = "a", Title = "A" }] };

        for (var i = 0; i < 3; i++) await Assert.ThrowsAsync<QuestionRejected>(() => mcp.Ask("main", bad));
        await mcp.Ask("main", bad);

        var element = QuestionStore.ListQuestions(Main(host)).Single();
        Assert.True((bool)element.Meta["degraded"]!);
        Assert.StartsWith("CodeChroma rejected the question.", (string?)element.Meta["validation"]);
    }

    [Fact]
    public async Task An_agent_supplied_degraded_flag_does_not_skip_validation()
    {
        using var host = new BridgeHost();
        var request = AskRequest.FromJson(new JsonObject { ["question"] = "Q?", ["options"] = new JsonArray(), ["degraded"] = true });

        await Assert.ThrowsAsync<QuestionRejected>(() => Mcp(host).Ask("main", request));

        Assert.Empty(QuestionStore.ListQuestions(Main(host)));
    }

    [Fact]
    public async Task A_degraded_pass_through_consumes_the_count()
    {
        using var host = new BridgeHost();
        var mcp = Mcp(host);
        mcp.AskWait = TimeSpan.FromMilliseconds(50);
        var bad = new AskRequest { Question = "Q?", SessionId = "s", Options = [new QuestionOption { Id = "a", Title = "A" }] };

        for (var i = 0; i < 3; i++) await Assert.ThrowsAsync<QuestionRejected>(() => mcp.Ask("main", bad));
        await mcp.Ask("main", bad);
        await Assert.ThrowsAsync<QuestionRejected>(() => mcp.Ask("main", bad));

        Assert.Equal(1, mcp.Rejections.Count("main", "s"));
    }

    [Fact]
    public async Task Sessionless_agents_on_different_connections_do_not_share_a_counter()
    {
        using var host = new BridgeHost();
        var mcp = Mcp(host);
        var bad = new AskRequest { Question = "Q?", Options = [new QuestionOption { Id = "a", Title = "A" }] };

        for (var i = 0; i < 3; i++) await Assert.ThrowsAsync<QuestionRejected>(() => mcp.Ask("main", bad, "A"));
        await Assert.ThrowsAsync<QuestionRejected>(() => mcp.Ask("main", bad, "B"));

        Assert.Equal(3, mcp.Rejections.Count("main", "conn:A"));
        Assert.Equal(1, mcp.Rejections.Count("main", "conn:B"));
    }

    [Fact]
    public async Task The_ask_route_rejects_a_missing_token_and_a_token_for_another_workspace()
    {
        using var host = new BridgeHost();
        var body = JsonBody(new JsonObject { ["question"] = "Q?" });
        var other = new HttpRequestMessage(HttpMethod.Post, "/repos/main/questions/ask") { Content = JsonBody(new JsonObject { ["question"] = "Q?" }) };
        other.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Mcp(host).TokenFor("other"));

        var missing = await host.Client.PostAsync("/repos/main/questions/ask", body);
        var wrong = await host.Client.SendAsync(other);

        Assert.Equal(HttpStatusCode.Unauthorized, missing.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
    }
}
