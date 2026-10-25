using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>GET/POST /repos/{id}/questions (the user's side of ask_user) and the agent-facing /mcp endpoint (routes/questions.py).</summary>
public static class QuestionRoutes
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/repos/{repoId}/questions", (string repoId, WorkspaceRegistry registry, QuestionBroker broker) =>
            Reply.Guard(() =>
            {
                var open = QuestionStore.ListQuestions(registry.Get(repoId)).Where(e => QuestionStore.State(e) == "open")
                    .Select(e => (JsonNode?)View(e, broker.IsWaiting(Json.Str(e.Meta["question_id"]) ?? ""))).ToArray();
                return Reply.Json(new JsonObject { ["questions"] = new JsonArray(open) });
            }));

        app.MapPost("/repos/{repoId}/questions/ask", async (string repoId, HttpRequest request, QuestionMcp mcp) =>
        {
            var body = await Reply.LenientBody(request);
            return await Reply.GuardAsync(async () =>
            {
                var ask = AskRequest.FromJson(body);
                if (mcp.WorkspaceIdFor(McpJsonRpc.BearerToken(request.Headers.Authorization.ToString())) != repoId)
                    throw new QuestionAuthException("invalid or missing workspace token");
                return Reply.Json(await mcp.Ask(repoId, ask, cancel: request.HttpContext.RequestAborted));
            });
        });

        app.MapPost("/repos/{repoId}/questions/{questionId}/answer", async (string repoId, string questionId, HttpRequest request, WorkspaceRegistry registry, QuestionBroker broker) =>
        {
            var body = await Reply.LenientBody(request);
            return Reply.Guard(() => Answer(registry.Get(repoId), broker, questionId, body));
        });

        app.MapPost("/repos/{repoId}/questions/{questionId}/skip", (string repoId, string questionId, WorkspaceRegistry registry, QuestionBroker broker) =>
            Reply.Guard(() =>
            {
                var ws = registry.Get(repoId);
                var element = OpenElement(ws, questionId);
                if (!AllowedFlag(element, "allow_skip")) return Reply.Error(422, "this question cannot be skipped");
                QuestionStore.Settle(ws, element.Id, "skipped", new QuestionResult(Skipped: true));
                return Reply.Json(Ack(questionId, "skipped", broker.Skip(questionId)));
            }));

        app.MapPost("/repos/{repoId}/questions/{questionId}/request-diagram", (string repoId, string questionId, WorkspaceRegistry registry, QuestionBroker broker) =>
            Reply.Guard(() =>
            {
                var ws = registry.Get(repoId);
                var element = OpenElement(ws, questionId);
                var options = element.Meta["options"] as JsonArray ?? [];
                if (options.Count == 0) return Reply.Error(422, "this question has no options");
                if (options.All(o => Json.Truthy(o?["diagram_ref"]))) return Reply.Error(422, "every option already has a diagram");
                if (!Json.Truthy(element.Meta["diagram_requested"])) QuestionStore.RequestDiagram(ws, element, DateTime.UtcNow.ToString("o"));
                return Reply.Json(Ack(questionId, "open", broker.RequestDiagram(questionId)));
            }));

        app.MapPost("/repos/{repoId}/questions/{questionId}/revise", (string repoId, string questionId, WorkspaceRegistry registry, QuestionBroker broker) =>
            Reply.Guard(() =>
            {
                var ws = registry.Get(repoId);
                var removed = QuestionStore.Reopen(ws, FindElement(ws, questionId));
                broker.Forget(questionId);
                var ack = Ack(questionId, "open", false);
                ack["removed"] = new JsonArray(removed.Select(id => (JsonNode?)id).ToArray());
                return Reply.Json(ack);
            }));

        // Plain JSON-RPC like the per-run endpoint; initialize issues an Mcp-Session-Id so sessionless agents get their own retry counter.
        app.MapPost("/mcp", async (HttpRequest request, QuestionMcp mcp) =>
        {
            var body = await Reply.LenientBody(request);
            return await Reply.GuardAsync(async () =>
            {
                var connection = request.Headers["Mcp-Session-Id"].ToString();
                var response = await mcp.HandleMcp(request.Headers.Authorization.ToString(), connection.Length > 0 ? connection : null, body, request.HttpContext.RequestAborted);
                if (response is null) return Results.StatusCode(202);
                if (Json.Str(body["method"]) == "initialize") request.HttpContext.Response.Headers["Mcp-Session-Id"] = Guid.NewGuid().ToString("N");
                return Results.Text(response.ToJsonString(), "application/json; charset=utf-8");
            });
        });
    }

    private static JsonObject View(CanvasElement element, bool waiting)
    {
        var view = new JsonObject { ["element_id"] = element.Id, ["question"] = element.Label, ["waiting"] = waiting };
        Json.CopyInto(view, element.Meta);
        return view;
    }

    private static JsonObject Ack(string questionId, string state, bool waiting, string? answer = null)
    {
        var ack = new JsonObject { ["ok"] = true, ["question_id"] = questionId, ["state"] = state, ["waiting"] = waiting };
        if (answer is not null) ack["answer"] = answer;
        return ack;
    }

    private static CanvasElement FindElement(Workspace ws, string questionId) =>
        QuestionStore.FindElement(ws, questionId) ?? throw new BridgeException(404, "unknown question");

    private static CanvasElement OpenElement(Workspace ws, string questionId)
    {
        var element = FindElement(ws, questionId);
        return QuestionStore.State(element) == "open" ? element : throw new BridgeException(409, "question is already settled");
    }

    private static bool AllowedFlag(CanvasElement element, string key) => Json.BoolOr(element.Meta[key], true);

    private static IResult Answer(Workspace ws, QuestionBroker broker, string questionId, JsonObject body)
    {
        var element = OpenElement(ws, questionId);
        if (body["answer"] is { } raw && Json.Str(raw) is null) return Reply.Error(422, "answer must be a string");
        if (body["option_id"] is { } rawOption && Json.Str(rawOption) is null) return Reply.Error(422, "option_id must be a string");
        var text = (Json.Str(body["answer"]) ?? "").Trim();
        var optionId = Json.Str(body["option_id"]);
        if (optionId is not null)
        {
            var option = (element.Meta["options"] as JsonArray ?? []).FirstOrDefault(o => Json.Str(o?["id"]) == optionId);
            if (option is null) return Reply.Error(422, "unknown option_id");
            if (text.Length == 0) text = Json.Str(option["title"]) ?? "";
        }
        else if (!AllowedFlag(element, "allow_custom"))
        {
            return Reply.Error(422, "this question takes no custom answer");
        }
        if (text.Length == 0) return Reply.Error(422, "answer is empty");
        QuestionStore.Settle(ws, element.Id, "answered", new QuestionResult(Answer: text, OptionId: optionId));
        return Reply.Json(Ack(questionId, "answered", broker.Answer(questionId, text, optionId), text));
    }
}
