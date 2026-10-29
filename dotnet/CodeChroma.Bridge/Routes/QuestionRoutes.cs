using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>GET/POST /repos/{id}/questions and the bearer-authenticated /mcp/ endpoint; a completed batch of answers is typed into the asking agent's terminal.</summary>
public static class QuestionRoutes
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/repos/{repoId}/questions", (string repoId, WorkspaceRegistry registry, AgentSessionRegistry sessions) =>
        {
            var ws = registry.Get(repoId);
            var open = QuestionStore.ListQuestions(ws).Where(e => Json.Str(e.Meta["state"]) == "open")
                .Select(e => (JsonNode?)View(e, HasLiveAgent(sessions, e))).ToArray();
            return Reply.Json(new JsonObject { ["questions"] = new JsonArray(open) });
        });

        app.MapPost("/repos/{repoId}/questions/ask", async (string repoId, HttpRequest request, QuestionMcp questions) =>
        {
            var body = await Reply.LenientBody(request);
            try
            {
                if (questions.WorkspaceIdFor(QuestionMcp.BearerToken(request.Headers.Authorization.ToString())) != repoId)
                    throw new QuestionAuthException("invalid or missing workspace token");
                return Reply.Json(await questions.Ask(repoId, AskRequest.FromJson(body), cancellation: request.HttpContext.RequestAborted));
            }
            catch (QuestionAuthException)
            {
                return Reply.Error(401, "invalid or missing workspace token");
            }
            catch (QuestionRejected rejected)
            {
                return Reply.Error(422, rejected.Message);
            }
        });

        app.MapPost("/repos/{repoId}/questions/{questionId}/answer", async (string repoId, string questionId, HttpRequest request, WorkspaceRegistry registry, AgentSessionRegistry sessions) =>
        {
            var body = await Reply.LenientBody(request);
            return WithCanvasLock(registry.Get(repoId), ws =>
            {
                var element = OpenElement(ws, questionId);
                if ((body["answer"] is not null && Json.Str(body["answer"]) is null) || (body["option_id"] is not null && Json.Str(body["option_id"]) is null))
                    return Reply.Error(422, "answer and option_id must be strings");
                var text = (Json.Str(body["answer"]) ?? "").Trim();
                var optionId = Json.Str(body["option_id"]);
                if (optionId is not null)
                {
                    var option = (element.Meta["options"] as JsonArray ?? []).FirstOrDefault(o => Json.Str(o?["id"]) == optionId);
                    if (option is null) return Reply.Error(422, "unknown option_id");
                    if (text.Length == 0) text = Json.Str(option["title"]) ?? "";
                }
                else if (!Flag(element, "allow_custom"))
                {
                    return Reply.Error(422, "this question takes no custom answer");
                }
                if (text.Length == 0) return Reply.Error(422, "answer is empty");
                QuestionStore.Settle(ws, element.Id, "answered", new QuestionResult { Answer = text, OptionId = optionId });
                return Reply.Json(Ack(questionId, "answered", text, Deliver(sessions, ws, questionId)));
            });
        });

        app.MapPost("/repos/{repoId}/questions/{questionId}/skip", (string repoId, string questionId, WorkspaceRegistry registry, AgentSessionRegistry sessions) => WithCanvasLock(registry.Get(repoId), ws =>
        {
            var element = OpenElement(ws, questionId);
            if (!Flag(element, "allow_skip")) return Reply.Error(422, "this question cannot be skipped");
            QuestionStore.Settle(ws, element.Id, "skipped", new QuestionResult { Skipped = true });
            return Reply.Json(Ack(questionId, "skipped", null, Deliver(sessions, ws, questionId)));
        }));

        app.MapPost("/repos/{repoId}/questions/{questionId}/request-diagram", (string repoId, string questionId, WorkspaceRegistry registry, AgentSessionRegistry sessions) => WithCanvasLock(registry.Get(repoId), ws =>
        {
            var element = OpenElement(ws, questionId);
            var options = element.Meta["options"] as JsonArray ?? [];
            if (options.Count == 0) return Reply.Error(422, "this question has no options");
            if (options.All(o => !string.IsNullOrEmpty(Json.Str(o?["diagram_ref"])))) return Reply.Error(422, "every option already has a diagram");
            if (!Json.Truthy(element.Meta["diagram_requested"])) QuestionStore.RequestDiagram(ws, element, DateTimeOffset.UtcNow.ToString("O"));
            return Reply.Json(Ack(questionId, "open", null, QuestionDelivery.Deliver(sessions, element, QuestionDelivery.DiagramRequestMessage(element))));
        }));

        app.MapPost("/repos/{repoId}/questions/{questionId}/revise", (string repoId, string questionId, WorkspaceRegistry registry) => WithCanvasLock(registry.Get(repoId), ws =>
        {
            var removed = QuestionStore.Reopen(ws, FindElement(ws, questionId));
            var ack = Ack(questionId, "open", null, false);
            ack["removed"] = new JsonArray(removed.Select(id => (JsonNode?)id).ToArray());
            return Reply.Json(ack);
        }));

        MapMcp(app);
    }

    private static void MapMcp(WebApplication app)
    {
        app.MapPost("/mcp/", McpPost);
        // No server-initiated stream and no client-terminable sessions: the transport spec allows 405 for both.
        app.MapGet("/mcp/", () => Results.StatusCode(405));
        app.MapDelete("/mcp/", () => Results.StatusCode(405));
    }

    private static async Task<IResult> McpPost(HttpRequest request, QuestionMcp questions, HttpResponse response)
    {
        var body = await Reply.LenientBody(request);
        var connection = request.Headers[QuestionMcp.SessionHeader].ToString();
        try
        {
            var reply = await questions.HandleMcp(request.Headers.Authorization.ToString(), body, connection.Length > 0 ? connection : null, request.HttpContext.RequestAborted);
            if (reply is null) return Results.StatusCode(202);
            if (Json.Str(body["method"]) == "initialize" && connection.Length == 0) response.Headers[QuestionMcp.SessionHeader] = Guid.NewGuid().ToString("N");
            return Results.Text(reply.ToJsonString(), "application/json; charset=utf-8");
        }
        catch (QuestionAuthException)
        {
            return Reply.Error(401, "invalid or missing workspace token");
        }
    }

    private static bool HasLiveAgent(AgentSessionRegistry sessions, CanvasElement element) =>
        Json.Str(element.Meta["agent_id"]) is { Length: > 0 } agent && sessions.Get(agent) is { IsAlive: true };

    /// <summary>Reads the just-settled element back and wakes its agent once the batch is complete; true when a live session will get it.</summary>
    private static bool Deliver(AgentSessionRegistry sessions, Workspace ws, string questionId) =>
        QuestionStore.FindElement(ws, questionId) is { } settled && QuestionDelivery.DeliverSettled(sessions, ws, settled);

    private static JsonObject View(CanvasElement element, bool waiting)
    {
        var view = new JsonObject { ["element_id"] = element.Id, ["question"] = element.Label, ["waiting"] = waiting };
        foreach (var (key, value) in element.Meta) view[key] = value?.DeepClone();
        return view;
    }

    private static JsonObject Ack(string questionId, string state, string? answer, bool waiting)
    {
        var ack = new JsonObject { ["ok"] = true, ["question_id"] = questionId, ["state"] = state, ["waiting"] = waiting };
        if (answer is not null) ack["answer"] = answer;
        return ack;
    }

    private static bool Flag(CanvasElement element, string key) => element.Meta[key] is null || Json.Bool(element.Meta[key]);

    // Validate the current state, save it and notify the broker as one transition.
    private static IResult WithCanvasLock(Workspace ws, Func<Workspace, IResult> action) => Reply.Guard(() =>
    {
        lock (CanvasWrite.LockFor(ws.Id)) return action(ws);
    });

    private static CanvasElement FindElement(Workspace ws, string questionId) =>
        QuestionStore.FindElement(ws, questionId) ?? throw new BridgeException(404, "unknown question");

    private static CanvasElement OpenElement(Workspace ws, string questionId)
    {
        var element = FindElement(ws, questionId);
        return Json.Str(element.Meta["state"]) == "open" ? element : throw new BridgeException(409, "question is already settled");
    }
}
