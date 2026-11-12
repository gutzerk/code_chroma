using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>GET/POST /repos/{id}/questions, the agent-scoped /agents/{id}/questions the agent window uses, and the bearer-authenticated /mcp/ endpoint; a completed batch of answers is typed into the asking agent's terminal.</summary>
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
            if (!questions.Authorizes(request.Headers.Authorization.ToString(), repoId)) return Reply.Error(401, "invalid or missing workspace token");
            try
            {
                return Reply.Json(await questions.Ask(repoId, AskRequest.FromJson(body), cancellation: request.HttpContext.RequestAborted));
            }
            catch (QuestionRejected rejected)
            {
                return Reply.Error(422, rejected.Message);
            }
        });

        app.MapPost("/repos/{repoId}/questions/{questionId}/answer", async (string repoId, string questionId, HttpRequest request, WorkspaceRegistry registry, AgentSessionRegistry sessions, AgentQuestionEvents events) =>
            Answer(registry.Get(repoId), questionId, null, await Reply.LenientBody(request), sessions, events));
        app.MapPost("/repos/{repoId}/questions/{questionId}/skip", (string repoId, string questionId, WorkspaceRegistry registry, AgentSessionRegistry sessions, AgentQuestionEvents events) =>
            Skip(registry.Get(repoId), questionId, null, sessions, events));
        app.MapPost("/repos/{repoId}/questions/{questionId}/chat", (string repoId, string questionId, WorkspaceRegistry registry, AgentSessionRegistry sessions, AgentQuestionEvents events) =>
            Chat(registry.Get(repoId), questionId, null, sessions, events));
        app.MapPost("/repos/{repoId}/questions/{questionId}/request-diagram", (string repoId, string questionId, WorkspaceRegistry registry, AgentSessionRegistry sessions, AgentQuestionEvents events) =>
            RequestDiagram(registry.Get(repoId), questionId, null, sessions, events));
        app.MapPost("/repos/{repoId}/questions/{questionId}/revise", (string repoId, string questionId, WorkspaceRegistry registry, AgentQuestionEvents events) =>
            Revise(registry.Get(repoId), questionId, null, events));

        MapAgentScoped(app);
        MapMcp(app);
    }

    /// <summary>The agent window's routes: one agent's questions in the workspace its ask_user writes to, resolved by the bridge.</summary>
    private static void MapAgentScoped(WebApplication app)
    {
        app.MapGet("/agents/{agentId}/questions", (string agentId, AgentManager agents, WorkspaceRegistry registry) => Reply.GuardBlocking(() =>
        {
            KnownAgent(agents, agentId);
            return Reply.Json(AgentQuestionView.Read(registry, agentId));
        }));
        app.MapPost("/agents/{agentId}/questions/{questionId}/answer", async (string agentId, string questionId, HttpRequest request, AgentManager agents, WorkspaceRegistry registry, AgentSessionRegistry sessions, AgentQuestionEvents events) =>
        {
            var body = await Reply.LenientBody(request);
            return await AgentWrite(agents, registry, agentId, ws => Answer(ws, questionId, agentId, body, sessions, events));
        });
        app.MapPost("/agents/{agentId}/questions/{questionId}/skip", (string agentId, string questionId, AgentManager agents, WorkspaceRegistry registry, AgentSessionRegistry sessions, AgentQuestionEvents events) =>
            AgentWrite(agents, registry, agentId, ws => Skip(ws, questionId, agentId, sessions, events)));
        app.MapPost("/agents/{agentId}/questions/{questionId}/chat", (string agentId, string questionId, AgentManager agents, WorkspaceRegistry registry, AgentSessionRegistry sessions, AgentQuestionEvents events) =>
            AgentWrite(agents, registry, agentId, ws => Chat(ws, questionId, agentId, sessions, events)));
        app.MapPost("/agents/{agentId}/questions/{questionId}/request-diagram", (string agentId, string questionId, AgentManager agents, WorkspaceRegistry registry, AgentSessionRegistry sessions, AgentQuestionEvents events) =>
            AgentWrite(agents, registry, agentId, ws => RequestDiagram(ws, questionId, agentId, sessions, events)));
        app.MapPost("/agents/{agentId}/questions/{questionId}/revise", (string agentId, string questionId, AgentManager agents, WorkspaceRegistry registry, AgentQuestionEvents events) =>
            AgentWrite(agents, registry, agentId, ws => Revise(ws, questionId, agentId, events)));
    }

    /// <summary>404 for an unknown agent, else the action on the workspace the agent asks into (brought up off the request thread).</summary>
    private static Task<IResult> AgentWrite(AgentManager agents, WorkspaceRegistry registry, string agentId, Func<Workspace, IResult> action) => Reply.GuardAsync(async () =>
    {
        KnownAgent(agents, agentId);
        return action(await Task.Run(() => registry.Get(agentId)));
    });

    private static void KnownAgent(AgentManager agents, string agentId)
    {
        try { agents.Get(agentId); }
        catch (UnknownAgentException) { throw new BridgeException(404, $"unknown agent: {agentId}"); }
    }

    private static IResult Answer(Workspace ws, string questionId, string? agentId, JsonObject body, AgentSessionRegistry sessions, AgentQuestionEvents events) => WithCanvasLock(ws, _ =>
    {
        var element = OpenElement(ws, questionId, agentId);
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
        var waiting = Deliver(sessions, events, ws, questionId);
        events.Changed(Owner(element));
        return Reply.Json(Ack(questionId, "answered", text, waiting));
    });

    private static IResult Skip(Workspace ws, string questionId, string? agentId, AgentSessionRegistry sessions, AgentQuestionEvents events) => WithCanvasLock(ws, _ =>
    {
        var element = OpenElement(ws, questionId, agentId);
        if (!Flag(element, "allow_skip")) return Reply.Error(422, "this question cannot be skipped");
        QuestionStore.Settle(ws, element.Id, "skipped", new QuestionResult { Skipped = true });
        var waiting = Deliver(sessions, events, ws, questionId);
        events.Changed(Owner(element));
        return Reply.Json(Ack(questionId, "skipped", null, waiting));
    });

    /// <summary>"Chat about it": closes the question and tells the agent the user wants to discuss it instead of picking an option.</summary>
    private static IResult Chat(Workspace ws, string questionId, string? agentId, AgentSessionRegistry sessions, AgentQuestionEvents events) => WithCanvasLock(ws, _ =>
    {
        var element = OpenElement(ws, questionId, agentId);
        QuestionStore.Settle(ws, element.Id, "chat", new QuestionResult());
        var waiting = Deliver(sessions, events, ws, questionId);
        events.Changed(Owner(element));
        return Reply.Json(Ack(questionId, "chat", null, waiting));
    });

    private static IResult RequestDiagram(Workspace ws, string questionId, string? agentId, AgentSessionRegistry sessions, AgentQuestionEvents events) => WithCanvasLock(ws, _ =>
    {
        var element = OpenElement(ws, questionId, agentId);
        var options = element.Meta["options"] as JsonArray ?? [];
        if (options.Count == 0) return Reply.Error(422, "this question has no options");
        if (options.All(o => !string.IsNullOrEmpty(Json.Str(o?["diagram_ref"])))) return Reply.Error(422, "every option already has a diagram");
        if (!Json.Truthy(element.Meta["diagram_requested"]))
        {
            QuestionStore.RequestDiagram(ws, element, DateTimeOffset.UtcNow.ToString("O"));
            events.Changed(Owner(element));
        }
        return Reply.Json(Ack(questionId, "open", null, QuestionDelivery.Deliver(sessions, element, QuestionDelivery.DiagramRequestMessage(element))));
    });

    private static IResult Revise(Workspace ws, string questionId, string? agentId, AgentQuestionEvents events) => WithCanvasLock(ws, _ =>
    {
        var element = FindElement(ws, questionId, agentId);
        var removed = QuestionStore.Reopen(ws, element);
        events.Changed(Owner(element));
        var ack = Ack(questionId, "open", null, false);
        ack["removed"] = new JsonArray(removed.Select(id => (JsonNode?)id).ToArray());
        return Reply.Json(ack);
    });

    private static string? Owner(CanvasElement element) => Json.Str(element.Meta["agent_id"]);

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
        QuestionDelivery.LiveSession(sessions, Json.Str(element.Meta["agent_id"])) is not null;

    /// <summary>Reads the just-settled element back and wakes its agent once the batch is complete; true when a live session will get it.</summary>
    private static bool Deliver(AgentSessionRegistry sessions, AgentQuestionEvents events, Workspace ws, string questionId) =>
        QuestionStore.FindElement(ws, questionId) is { } settled && QuestionDelivery.DeliverSettled(sessions, ws, settled, events.Changed);

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

    /// <summary>The question by id; with an agent scope only one that agent asked, so an agent route never reaches a neighbour's question.</summary>
    private static CanvasElement FindElement(Workspace ws, string questionId, string? agentId) =>
        QuestionStore.FindElement(ws, questionId) is { } element && (agentId is null || Owner(element) == agentId)
            ? element
            : throw new BridgeException(404, "unknown question");

    private static CanvasElement OpenElement(Workspace ws, string questionId, string? agentId)
    {
        var element = FindElement(ws, questionId, agentId);
        return Json.Str(element.Meta["state"]) == "open" ? element : throw new BridgeException(409, "question is already settled");
    }
}
