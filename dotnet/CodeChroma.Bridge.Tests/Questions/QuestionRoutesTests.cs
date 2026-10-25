using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Workspaces;
using Microsoft.Extensions.DependencyInjection;

namespace CodeChroma.Bridge.Tests.Questions;

/// <summary>Port of test_bridge_questions_route.py and the MCP/ask parts of test_question_validation.py and test_question_agent_wiring.py.</summary>
public sealed class QuestionRoutesTests : IDisposable
{
    private readonly BridgeHost _host = new();
    private QuestionMcp Mcp => _host.Factory.Services.GetRequiredService<QuestionMcp>();
    private QuestionBroker Broker => _host.Factory.Services.GetRequiredService<QuestionBroker>();
    private Workspace Main => _host.Factory.Services.GetRequiredService<WorkspaceRegistry>().Get("main");

    public void Dispose() => _host.Dispose();

    private static QuestionOption Option(string id, string title, int rank, string? diagramRef = null) =>
        new() { Id = id, Title = title, Rank = rank, Description = "d", Pro = "p", Con = "c", Why = "w", DiagramRef = diagramRef };

    private static List<QuestionOption> Options() => [Option("a", "Modular monolith", 1), Option("b", "Microservices", 2)];

    private string Seed(string? session = null, bool allowCustom = true, bool allowSkip = true, List<QuestionOption>? options = null, int? total = null)
    {
        var id = Guid.NewGuid().ToString("N");
        QuestionStore.OpenQuestion(Main, new AskRequest { Question = "How to structure checkout?", Options = options ?? Options(), SessionId = session, AllowCustom = allowCustom, AllowSkip = allowSkip, Total = total }, id);
        return id;
    }

    private async Task<(HttpStatusCode Status, JsonObject Body)> Post(string path, JsonObject? body = null, string? bearer = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = new StringContent((body ?? []).ToJsonString(), Encoding.UTF8, "application/json") };
        if (bearer is not null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        using var response = await _host.Client.SendAsync(request);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, text.Length == 0 ? [] : (JsonNode.Parse(text) as JsonObject ?? []));
    }

    private async Task<JsonObject> GetQuestions() => (JsonObject)JsonNode.Parse(await _host.Client.GetStringAsync("/repos/main/questions"))!;

    private static async Task<JsonObject?> WaitForOpen(Func<JsonObject?> probe)
    {
        for (var i = 0; i < 300; i++)
        {
            if (probe() is { } found) return found;
            await Task.Delay(10);
        }
        return null;
    }

    [Fact]
    public async Task Open_question_writes_a_question_element_with_the_documented_meta()
    {
        var id = Seed("s1", total: 3);

        var canvas = (JsonObject)JsonNode.Parse(await _host.Client.GetStringAsync("/repos/main/canvas"))!;

        var element = canvas["elements"]!.AsObject().Select(kv => kv.Value!.AsObject()).Single(e => e["render"]!.GetValue<string>() == "question");
        Assert.Equal("How to structure checkout?", element["label"]!.GetValue<string>());
        Assert.Equal("questions", element["layer"]!.GetValue<string>());
        Assert.Equal(id, element["meta"]!["question_id"]!.GetValue<string>());
        Assert.Equal("open", element["meta"]!["state"]!.GetValue<string>());
        Assert.Equal((1, 3), (element["meta"]!["step"]!.GetValue<int>(), element["meta"]!["total"]!.GetValue<int>()));
        Assert.Equal("Modular monolith", element["meta"]!["options"]![0]!["title"]!.GetValue<string>());
    }

    [Fact]
    public void The_second_question_in_a_session_gets_the_next_step()
    {
        Seed("s1");
        var second = Seed("s1");

        Assert.Equal(2, QuestionStore.FindElement(Main, second)!.Meta["step"]!.GetValue<int>());
    }

    [Fact]
    public async Task Get_questions_lists_open_ones_as_not_waiting_without_a_live_waiter()
    {
        var id = Seed();

        var question = (await GetQuestions())["questions"]!.AsArray().Single()!;

        Assert.Equal(id, question["question_id"]!.GetValue<string>());
        Assert.False(question["waiting"]!.GetValue<bool>());
        Assert.Equal("How to structure checkout?", question["question"]!.GetValue<string>());
    }

    [Fact]
    public async Task Answer_with_an_option_records_its_title_on_the_element()
    {
        var id = Seed();

        var (status, body) = await Post($"/repos/main/questions/{id}/answer", new JsonObject { ["option_id"] = "a" });

        var element = QuestionStore.FindElement(Main, id)!;
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal($$"""{"ok":true,"question_id":"{{id}}","state":"answered","waiting":false,"answer":"Modular monolith"}""", body.ToJsonString());
        Assert.Equal(("answered", "Modular monolith", "a"), (QuestionStore.State(element), element.Meta["answer"]!.GetValue<string>(), element.Meta["option_id"]!.GetValue<string>()));
        Assert.Empty((await GetQuestions())["questions"]!.AsArray());
    }

    [Fact]
    public async Task A_custom_answer_is_accepted_and_an_empty_or_unknown_option_is_refused()
    {
        var id = Seed();
        var url = $"/repos/main/questions/{id}/answer";

        var empty = await Post(url, new JsonObject { ["answer"] = "  " });
        var unknown = await Post(url, new JsonObject { ["option_id"] = "zzz" });
        var custom = await Post(url, new JsonObject { ["answer"] = "event sourcing" });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, empty.Status);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, unknown.Status);
        Assert.Equal(HttpStatusCode.OK, custom.Status);
        Assert.Equal("event sourcing", QuestionStore.FindElement(Main, id)!.Meta["answer"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_custom_answer_is_refused_when_not_allowed()
    {
        var id = Seed(allowCustom: false);

        var (status, _) = await Post($"/repos/main/questions/{id}/answer", new JsonObject { ["answer"] = "mine" });

        Assert.Equal(HttpStatusCode.UnprocessableEntity, status);
    }

    [Fact]
    public async Task Skip_marks_the_element_skipped_and_a_second_settle_conflicts()
    {
        var id = Seed();

        var first = await Post($"/repos/main/questions/{id}/skip");
        var again = await Post($"/repos/main/questions/{id}/skip");

        Assert.True(first.Body["ok"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.Conflict, again.Status);
        Assert.Equal("skipped", QuestionStore.State(QuestionStore.FindElement(Main, id)!));
    }

    [Fact]
    public async Task Skip_is_refused_when_not_allowed_and_an_unknown_question_is_404()
    {
        var id = Seed(allowSkip: false);

        var refused = await Post($"/repos/main/questions/{id}/skip");
        var missing = await Post("/repos/main/questions/nope/skip");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, refused.Status);
        Assert.Equal(HttpStatusCode.NotFound, missing.Status);
    }

    [Fact]
    public async Task The_answer_route_wakes_a_blocked_ask()
    {
        var asking = Task.Run(() => Mcp.Ask("main", new AskRequest { Question = "Pick", Options = Options() }));
        var open = await WaitForOpen(() =>
            QuestionStore.ListQuestions(Main).FirstOrDefault() is { } e && Broker.IsWaiting(e.Meta["question_id"]!.GetValue<string>()) ? e.Meta : null);

        var (_, reply) = await Post($"/repos/main/questions/{open!["question_id"]!.GetValue<string>()}/answer", new JsonObject { ["option_id"] = "b" });
        var result = await asking.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.True(reply["waiting"]!.GetValue<bool>());
        Assert.Equal("answered", reply["state"]!.GetValue<string>());
        Assert.Equal("""{"answer":"Microservices","option_id":"b","skipped":false}""", result.ToJsonString());
    }

    [Fact]
    public async Task Ask_returns_pending_on_timeout_and_result_fetches_the_later_answer()
    {
        Mcp.AskWait = TimeSpan.FromMilliseconds(50);

        var pending = await Mcp.Ask("main", new AskRequest { Question = "Pick", Options = Options() });
        var questionId = pending["question_id"]!.GetValue<string>();
        Broker.Answer(questionId, "late");
        var later = await Mcp.Result("main", questionId);

        Assert.True(pending["pending"]!.GetValue<bool>());
        Assert.Equal("""{"answer":"late","option_id":null,"skipped":false}""", later.ToJsonString());
    }

    [Fact]
    public async Task Result_reads_the_element_when_the_broker_does_not_know_the_question()
    {
        var id = Seed();
        await Post($"/repos/main/questions/{id}/skip");
        var fresh = new QuestionMcp(new QuestionBroker(), _ => Main);

        var result = await fresh.Result("main", id);

        Assert.Equal("""{"answer":null,"option_id":null,"skipped":true}""", result.ToJsonString());
    }

    [Fact]
    public void A_token_names_its_workspace_and_a_forged_one_is_refused()
    {
        var token = Mcp.TokenFor("main");

        Assert.Equal("main", Mcp.WorkspaceIdFor(token));
        foreach (var forged in new[] { token + "0", "main.deadbeef", "", null })
            Assert.Throws<QuestionAuthException>(() => Mcp.WorkspaceIdFor(forged));
    }

    [Fact]
    public async Task Revise_reopens_the_question_and_deletes_later_steps_of_its_session()
    {
        var first = Seed("s1");
        var second = Seed("s1");
        await Post($"/repos/main/questions/{first}/answer", new JsonObject { ["option_id"] = "a" });
        await Post($"/repos/main/questions/{second}/answer", new JsonObject { ["option_id"] = "b" });

        var (_, body) = await Post($"/repos/main/questions/{first}/revise");

        var reopened = QuestionStore.FindElement(Main, first)!;
        Assert.Equal("open", body["state"]!.GetValue<string>());
        Assert.Single(body["removed"]!.AsArray());
        Assert.Equal("open", QuestionStore.State(reopened));
        Assert.Null(reopened.Meta["answer"]);
        Assert.Null(QuestionStore.FindElement(Main, second));
        Assert.Equal("questions", reopened.Layer);
    }

    [Fact]
    public async Task Request_diagram_marks_the_element_and_counts_the_request_once()
    {
        var id = Seed();
        var url = $"/repos/main/questions/{id}/request-diagram";

        var first = await Post(url);
        var second = await Post(url);

        var meta = QuestionStore.FindElement(Main, id)!.Meta;
        Assert.Equal("open", first.Body["state"]!.GetValue<string>());
        Assert.True(meta["diagram_requested"]!.GetValue<bool>());
        Assert.Equal(1, meta["diagram_requests"]!.GetValue<int>());
        Assert.NotEmpty(meta["diagram_requested_at"]!.GetValue<string>());
        Assert.False(first.Body["waiting"]!.GetValue<bool>());
        Assert.False(second.Body["waiting"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Request_diagram_is_refused_when_every_option_has_a_diagram()
    {
        var id = Seed(options: [Option("a", "A", 1, "x"), Option("b", "B", 2, "x")]);

        var (status, _) = await Post($"/repos/main/questions/{id}/request-diagram");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, status);
    }

    [Fact]
    public async Task Request_diagram_hands_needs_to_the_blocked_ask()
    {
        var asking = Task.Run(() => Mcp.Ask("main", new AskRequest { Question = "Pick", Options = Options() }));
        var open = await WaitForOpen(() => QuestionStore.ListQuestions(Main).FirstOrDefault() is { } e && Broker.IsWaiting(e.Meta["question_id"]!.GetValue<string>()) ? e.Meta : null);
        var id = open!["question_id"]!.GetValue<string>();

        await Post($"/repos/main/questions/{id}/request-diagram");
        var result = await asking.WaitAsync(TimeSpan.FromSeconds(5));

        Assert.Equal($$"""{"needs":"diagram","question_id":"{{id}}"}""", result.ToJsonString());
    }

    [Fact]
    public async Task A_reask_after_a_diagram_request_updates_the_same_element()
    {
        Mcp.AskWait = TimeSpan.FromMilliseconds(50);
        await Mcp.Ask("main", new AskRequest { Question = "Which way?", Options = Options(), SessionId = "s" });
        var element = QuestionStore.ListQuestions(Main).Single();
        QuestionStore.RequestDiagram(Main, element, "now");
        var drawn = await Mcp.DrawDiagram("main", "T", [new DiagramNode("a", "a")], [], null, null);
        var options = new List<QuestionOption> { Option("a", "A", 1, drawn["diagram_ref"]!.GetValue<string>()), Option("b", "B", 2) };

        await Mcp.Ask("main", new AskRequest { Question = "Which way?", Options = options, SessionId = "s", Kind = "diagram" });

        var questions = QuestionStore.ListQuestions(Main);
        Assert.Equal([element.Id], questions.Select(q => q.Id));
        Assert.Equal(drawn["diagram_ref"]!.GetValue<string>(), questions[0].Meta["options"]![0]!["diagram_ref"]!.GetValue<string>());
        Assert.False(questions[0].Meta["diagram_requested"]!.GetValue<bool>());
    }

    [Fact]
    public void Find_diagram_requested_ignores_an_unrelated_ask_and_returns_the_newest_with_its_duplicates()
    {
        var old = Seed("s1");
        var latest = Seed("s1");
        foreach (var id in new[] { old, latest }) QuestionStore.RequestDiagram(Main, QuestionStore.FindElement(Main, id)!, "now");

        var other = QuestionStore.FindDiagramRequested(Main, new AskRequest { Question = "Unrelated?", SessionId = "s2" });
        var found = QuestionStore.FindDiagramRequested(Main, new AskRequest { Question = "x", SessionId = "s1" });
        var textMismatch = QuestionStore.FindDiagramRequested(Main, new AskRequest { Question = "Other?" });

        Assert.Null(other);
        Assert.Null(textMismatch);
        Assert.Equal(latest, found!.Value.Keep.Meta["question_id"]!.GetValue<string>());
        Assert.Equal([old], found.Value.Stale.Select(e => e.Meta["question_id"]!.GetValue<string>()));
    }

    [Fact]
    public async Task Ask_stamps_the_authenticated_workspace_as_agent_id()
    {
        using var cancel = new CancellationTokenSource();
        var asking = Mcp.Ask("main", new AskRequest { Question = "Pick", Options = Options(), AgentId = "spoofed" }, cancel: cancel.Token);
        await WaitForOpen(() => QuestionStore.ListQuestions(Main).Count > 0 ? [] : null);

        await cancel.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => asking);

        Assert.Equal("main", QuestionStore.ListQuestions(Main)[0].Meta["agent_id"]!.GetValue<string>());
    }

    [Fact]
    public async Task An_incomplete_ask_is_rejected_with_the_tool_error_and_creates_no_question()
    {
        var request = new AskRequest { Question = "Q?", Options = [new QuestionOption { Id = "a", Title = "A" }, new QuestionOption { Id = "a", Title = "A" }] };

        var error = await Assert.ThrowsAsync<QuestionRejected>(() => Mcp.Ask("main", request));

        Assert.StartsWith("CodeChroma rejected the question.", error.Message);
        Assert.Empty(QuestionStore.ListQuestions(Main));
    }

    [Fact]
    public async Task The_fourth_incomplete_ask_is_accepted_degraded()
    {
        Mcp.AskWait = TimeSpan.FromMilliseconds(50);
        var request = new AskRequest { Question = "Q?", SessionId = "s", Options = [new QuestionOption { Id = "a", Title = "A" }] };
        for (var i = 0; i < 3; i++) await Assert.ThrowsAsync<QuestionRejected>(() => Mcp.Ask("main", request));

        await Mcp.Ask("main", request);

        var meta = QuestionStore.ListQuestions(Main)[0].Meta;
        Assert.True(meta["degraded"]!.GetValue<bool>());
        Assert.StartsWith("CodeChroma rejected the question.", meta["validation"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_degraded_pass_through_consumes_the_count()
    {
        Mcp.AskWait = TimeSpan.FromMilliseconds(50);
        var bad = new AskRequest { Question = "Q?", SessionId = "s", Options = [new QuestionOption { Id = "a", Title = "A" }] };
        for (var i = 0; i < 3; i++) await Assert.ThrowsAsync<QuestionRejected>(() => Mcp.Ask("main", bad));
        await Mcp.Ask("main", bad);

        await Assert.ThrowsAsync<QuestionRejected>(() => Mcp.Ask("main", bad));

        Assert.Equal(1, Mcp.Rejections.Count("main", "s"));
    }

    [Fact]
    public async Task Sessionless_agents_on_different_connections_do_not_share_a_counter()
    {
        var bad = new AskRequest { Question = "Q?", Options = [new QuestionOption { Id = "a", Title = "A" }] };
        for (var i = 0; i < 3; i++) await Assert.ThrowsAsync<QuestionRejected>(() => Mcp.Ask("main", bad, "A"));

        await Assert.ThrowsAsync<QuestionRejected>(() => Mcp.Ask("main", bad, "B"));

        Assert.Equal(3, Mcp.Rejections.Count("main", "conn:A"));
        Assert.Equal(1, Mcp.Rejections.Count("main", "conn:B"));
    }

    [Fact]
    public async Task An_ask_with_an_unknown_diagram_ref_is_rejected()
    {
        var request = new AskRequest { Question = "Which way?", Options = [Option("a", "A", 1, "ghost"), Option("b", "B", 2)] };

        var error = await Assert.ThrowsAsync<QuestionRejected>(() => Mcp.Ask("main", request));

        Assert.Contains("ghost", error.Message);
    }

    [Fact]
    public async Task Draw_diagram_returns_a_ref_that_a_diagram_question_accepts()
    {
        Mcp.AskWait = TimeSpan.FromMilliseconds(50);
        var drawn = await Mcp.DrawDiagram("main", "Option A", [new DiagramNode("api", "api"), new DiagramNode("q", "q", Status: "new")], [new DiagramEdge("api", "q")], null, null);
        var options = new List<QuestionOption> { Option("a", "A", 1, drawn["diagram_ref"]!.GetValue<string>()), Option("b", "B", 2) };

        var result = await Mcp.Ask("main", new AskRequest { Question = "Which way?", Options = options, Kind = "diagram" });

        Assert.True(result["pending"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Draw_diagram_writes_nodes_on_the_decisions_layer_under_one_root()
    {
        var root = (await Mcp.DrawDiagram("main", "T", [new DiagramNode("a", "a", Status: "new"), new DiagramNode("b", "b")], [new DiagramEdge("a", "b")], null, null))["diagram_ref"]!.GetValue<string>();

        var doc = CanvasDoc.Load(Main.CanvasCorePath(), Main.DiagramsRoot());
        var members = doc.Elements.Values.Where(e => e.GroupId == root).ToList();
        Assert.Equal(["decisions"], members.Select(e => e.Layer).Distinct());
        Assert.Equal(["a", "b"], members.Select(e => e.Label!).Order());
        Assert.Equal("new", members.Single(e => e.Label == "a").Meta["status"]!.GetValue<string>());
        Assert.Single(doc.Edges);
    }

    [Fact]
    public async Task Draw_diagram_over_the_node_budget_or_with_an_empty_title_is_rejected()
    {
        var nodes = Enumerable.Range(0, OptionDiagrams.MaxNodes + 1).Select(i => new DiagramNode(i.ToString(), "n")).ToList();

        await Assert.ThrowsAsync<QuestionRejected>(() => Mcp.DrawDiagram("main", "T", nodes, [], null, null));
        var empty = await Assert.ThrowsAsync<QuestionRejected>(() => Mcp.DrawDiagram("main", "  ", [new DiagramNode("a", "a")], [], null, null));

        Assert.Contains("title is empty", empty.Message);
    }

    [Fact]
    public async Task Draw_diagram_attaches_the_ref_to_the_question_option()
    {
        var id = Seed();

        var root = (await Mcp.DrawDiagram("main", "T", [new DiagramNode("a", "a")], [], id, "b"))["diagram_ref"]!.GetValue<string>();

        var options = QuestionStore.FindElement(Main, id)!.Meta["options"]!.AsArray();
        Assert.Equal([null, root], options.Select(o => o!["diagram_ref"]?.GetValue<string>()));
    }

    [Fact]
    public async Task Draw_diagram_bands_do_not_overlap_after_a_diagram_is_deleted()
    {
        var nodes = new List<DiagramNode> { new("a", "a") };
        var roots = new List<string>();
        for (var i = 0; i < 2; i++) roots.Add(QuestionStore.DrawDiagram(Main, "T", nodes, [], null, null));
        using (var patch = new HttpRequestMessage(HttpMethod.Patch, "/repos/main/canvas") { Content = new StringContent($$"""{"ops":[{"op":"delete_element","id":"{{roots[0]}}"}]}""", Encoding.UTF8, "application/json") })
            (await _host.Client.SendAsync(patch)).EnsureSuccessStatusCode();

        var third = QuestionStore.DrawDiagram(Main, "T", nodes, [], null, null);

        var doc = CanvasDoc.Load(Main.CanvasCorePath(), Main.DiagramsRoot());
        Assert.True(doc.Elements[third].Position.Y > doc.Elements[roots[1]].Position.Y);
    }

    [Fact]
    public void Draw_diagram_with_an_unknown_option_leaves_no_orphan_diagram()
    {
        var id = Seed();

        Assert.Throws<QuestionWriteException>(() => QuestionStore.DrawDiagram(Main, "T", [new DiagramNode("a", "a")], [], id, "nope"));

        var doc = CanvasDoc.Load(Main.CanvasCorePath(), Main.DiagramsRoot());
        Assert.DoesNotContain(doc.Elements.Values, e => Json.Truthy(e.Meta["diagram_root"]));
    }

    [Fact]
    public async Task The_ask_route_rejects_a_missing_token_and_a_token_for_another_workspace()
    {
        var missing = await Post("/repos/main/questions/ask", new JsonObject { ["question"] = "Q?" });
        var other = await Post("/repos/main/questions/ask", new JsonObject { ["question"] = "Q?" }, Mcp.TokenFor("other"));

        Assert.Equal(HttpStatusCode.Unauthorized, missing.Status);
        Assert.Equal(HttpStatusCode.Unauthorized, other.Status);
    }

    [Fact]
    public async Task The_ask_route_maps_a_contract_break_to_422()
    {
        var (status, body) = await Post("/repos/main/questions/ask", new JsonObject { ["question"] = "Q?" }, Mcp.TokenFor("main"));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, status);
        Assert.StartsWith("CodeChroma rejected the question.", body["detail"]!.GetValue<string>());
    }

    private async Task<(HttpStatusCode Status, JsonObject Body)> Rpc(string method, JsonObject? parameters = null, string? bearer = null, string path = "/mcp/")
    {
        var request = new JsonObject { ["jsonrpc"] = "2.0", ["id"] = 1, ["method"] = method };
        if (parameters is not null) request["params"] = parameters;
        return await Post(path, request, bearer ?? Mcp.TokenFor("main"));
    }

    [Fact]
    public async Task The_mcp_endpoint_lists_the_three_tools_and_carries_the_contract_instructions()
    {
        var init = await Rpc("initialize", new JsonObject { ["protocolVersion"] = "2025-03-26" });
        var list = await Rpc("tools/list", path: "/mcp");

        var names = list.Body["result"]!["tools"]!.AsArray().Select(t => t!["name"]!.GetValue<string>());
        Assert.Equal(["ask_user", "ask_user_result", "draw_option_diagram"], names);
        Assert.Contains("ask_user", init.Body["result"]!["instructions"]!.GetValue<string>());
        Assert.Equal("codechroma", init.Body["result"]!["serverInfo"]!["name"]!.GetValue<string>());
    }

    [Fact]
    public async Task The_mcp_endpoint_refuses_a_forged_token()
    {
        var forged = await Rpc("tools/list", bearer: "main.deadbeef");

        Assert.Equal(HttpStatusCode.Unauthorized, forged.Status);
    }

    [Fact]
    public async Task The_mcp_ask_user_tool_blocks_until_answered_over_rest()
    {
        var call = Rpc("tools/call", new JsonObject { ["name"] = "ask_user", ["arguments"] = new JsonObject { ["question"] = "Pick", ["options"] = new JsonArray(Options().Select(o => (JsonNode?)o.ToJson()).ToArray()) } });
        var open = await WaitForOpen(() =>
            QuestionStore.ListQuestions(Main).FirstOrDefault() is { } e && Broker.IsWaiting(e.Meta["question_id"]!.GetValue<string>()) ? e.Meta : null);
        await Post($"/repos/main/questions/{open!["question_id"]!.GetValue<string>()}/answer", new JsonObject { ["option_id"] = "a" });

        var (_, body) = await call.WaitAsync(TimeSpan.FromSeconds(5));

        var result = body["result"]!;
        Assert.False(result["isError"]!.GetValue<bool>());
        Assert.Equal("Modular monolith", result["structuredContent"]!["answer"]!.GetValue<string>());
        Assert.Equal("""{"answer":"Modular monolith","option_id":"a","skipped":false}""", result["content"]![0]!["text"]!.GetValue<string>());
    }

    [Fact]
    public async Task The_mcp_ask_user_tool_returns_a_rejection_as_a_tool_error()
    {
        var (_, body) = await Rpc("tools/call", new JsonObject { ["name"] = "ask_user", ["arguments"] = new JsonObject { ["question"] = "Q?" } });

        var result = body["result"]!;
        Assert.True(result["isError"]!.GetValue<bool>());
        Assert.StartsWith("CodeChroma rejected the question.", result["content"]![0]!["text"]!.GetValue<string>());
    }

    [Fact]
    public async Task The_mcp_ask_user_result_and_draw_tools_work()
    {
        var drawn = await Rpc("tools/call", new JsonObject
        {
            ["name"] = "draw_option_diagram",
            ["arguments"] = new JsonObject
            {
                ["title"] = "T",
                ["nodes"] = new JsonArray(new JsonObject { ["id"] = "a", ["label"] = "A" }),
                ["edges"] = new JsonArray(),
            },
        });
        var pending = await Rpc("tools/call", new JsonObject { ["name"] = "ask_user_result", ["arguments"] = new JsonObject { ["question_id"] = "nope" } });

        Assert.False(drawn.Body["result"]!["isError"]!.GetValue<bool>());
        Assert.NotEmpty(drawn.Body["result"]!["structuredContent"]!["diagram_ref"]!.GetValue<string>());
        Assert.True(pending.Body["result"]!["structuredContent"]!["pending"]!.GetValue<bool>());
    }

    [Fact]
    public async Task A_notification_gets_202_and_a_get_gets_405()
    {
        using var notification = new HttpRequestMessage(HttpMethod.Post, "/mcp/") { Content = new StringContent("""{"jsonrpc":"2.0","method":"notifications/initialized"}""", Encoding.UTF8, "application/json") };
        notification.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Mcp.TokenFor("main"));

        using var accepted = await _host.Client.SendAsync(notification);
        using var probe = await _host.Client.GetAsync("/mcp/");

        Assert.Equal(HttpStatusCode.Accepted, accepted.StatusCode);
        Assert.Equal(HttpStatusCode.MethodNotAllowed, probe.StatusCode);
    }
}
