using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Stores;
using static CodeChroma.Bridge.Http.McpJsonRpc;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Questions;

/// <summary>Bridge-hosted MCP server: a blocking ask_user tool, its ask_user_result poll and draw_option_diagram (questions/mcp_server.py).</summary>
public sealed class QuestionMcp
{
    public const string ServerName = "codechroma";
    public const string Instructions =
        "Ask every decision question through ask_user, never in chat text and never with another question tool. "
        + "Each call needs: question, and 2-4 options that each have id, title, description, pro, con and why; exactly one option has rank 1 (your recommendation), the others a unique rank. "
        + "A call that breaks this is rejected with the list of problems: fix them and call again with the same intent. "
        + "For a question that changes structure (boundaries, data flow, ownership, a new component) use kind \"diagram\": first draw one small diagram per option with draw_option_diagram, then pass each returned diagram_ref on its option. "
        + "If ask_user returns {needs: \"diagram\"}, the user wants diagrams: draw them with draw_option_diagram and call ask_user again with the same session_id and question. "
        + "If it returns {pending: true}, poll ask_user_result.";

    private const string DrawDescription =
        "Draw a small decision diagram (max 12 nodes) for one option; returns its diagram_ref. "
        + "Nodes are {id, label, description?, status?}; status \"new\" marks a part that does not exist yet. "
        + "Edges are {from, to, label?}. Pass the returned diagram_ref on the option in ask_user.";

    private readonly byte[] _secret = RandomNumberGenerator.GetBytes(32);
    private readonly Func<string, Workspace> _workspaceFor;
    private readonly System.Collections.Concurrent.ConcurrentDictionary<(string, string), McpEndpoint> _endpoints = new();

    public QuestionMcp(QuestionBroker broker, WorkspaceRegistry registry) : this(broker, registry.Get)
    {
    }

    public QuestionMcp(QuestionBroker broker, Func<string, Workspace> workspaceFor)
    {
        Broker = broker;
        _workspaceFor = workspaceFor;
    }

    public QuestionBroker Broker { get; }
    public RejectionTracker Rejections { get; } = new();

    /// <summary>How long ask_user blocks before returning pending (settings.questions.ask_wait_seconds).</summary>
    public TimeSpan AskWait { get; set; } = TimeSpan.FromSeconds(300);

    /// <summary>Rejections per session before a malformed question is shown degraded (settings.questions.max_rejections).</summary>
    public int MaxRejections { get; set; } = 3;

    /// <summary>The bearer token for one workspace: `workspace_id.hmac`; stable for this process.</summary>
    public string TokenFor(string workspaceId) => workspaceId + "." + Sign(workspaceId);

    /// <summary>The endpoint an agent window reaches us on; one per workspace and URL, so its config file is written once.</summary>
    public McpEndpoint? EndpointFor(string workspaceId, string? baseUrl) =>
        string.IsNullOrEmpty(baseUrl) ? null : _endpoints.GetOrAdd((workspaceId, baseUrl.TrimEnd('/')), key => new McpEndpoint(key.Item1, key.Item2, TokenFor(key.Item1), AskWait));

    /// <summary>The workspace id a token names; raises QuestionAuthException if malformed or forged.</summary>
    public string WorkspaceIdFor(string? token)
    {
        var text = token ?? "";
        var dot = text.LastIndexOf('.');
        var workspaceId = dot < 0 ? "" : text[..dot];
        var signature = dot < 0 ? "" : text[(dot + 1)..];
        if (workspaceId.Length == 0 || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(signature), Encoding.UTF8.GetBytes(Sign(workspaceId))))
            throw new QuestionAuthException("invalid or missing workspace token");
        return workspaceId;
    }

    private string Sign(string workspaceId) => Convert.ToHexString(HMACSHA256.HashData(_secret, Encoding.UTF8.GetBytes(workspaceId))).ToLowerInvariant();

    /// <summary>Opens the question on the canvas, blocks for the answer, or returns pending.</summary>
    public async Task<JsonObject> Ask(string workspaceId, AskRequest request, string? connection = null, CancellationToken cancel = default)
    {
        var ws = _workspaceFor(workspaceId);
        var extra = await Check(ws, workspaceId, request, connection);
        request.AgentId = workspaceId;
        var found = await Task.Run(() => QuestionStore.FindDiagramRequested(ws, request), cancel);
        var questionId = found is { } existing ? Json.Str(existing.Keep.Meta["question_id"])! : Guid.NewGuid().ToString("N");
        if (found is not null) Broker.Forget(questionId);
        Broker.Open(questionId);
        try
        {
            if (found is { } reasked) await Task.Run(() => QuestionStore.Reask(ws, reasked.Keep, request, extra), cancel);
            else await Task.Run(() => QuestionStore.OpenQuestion(ws, request, questionId, extra), cancel);
            return (await Broker.Wait(questionId, AskWait, cancel)).ToToolJson();
        }
        catch
        {
            Broker.Close(questionId);
            throw;
        }
    }

    /// <summary>Raises QuestionRejected on a contract break; at the retry limit lets one through degraded.</summary>
    private async Task<JsonObject?> Check(Workspace ws, string workspaceId, AskRequest request, string? connection)
    {
        if (request.Degraded) return new JsonObject { ["degraded"] = true };
        var problems = QuestionValidation.Validate(request);
        if (problems.Count == 0 && request.Options.Any(o => !string.IsNullOrEmpty(o.DiagramRef)))
            problems = QuestionValidation.UnknownRefs(request, await Task.Run(() => QuestionStore.KnownElementIds(ws)));
        var key = !string.IsNullOrEmpty(request.SessionId) ? request.SessionId : string.IsNullOrEmpty(connection) ? null : "conn:" + connection;
        if (problems.Count == 0)
        {
            Rejections.Reset(workspaceId, key);
            return null;
        }
        var text = QuestionValidation.RejectionText(problems);
        if (Rejections.Count(workspaceId, key) < MaxRejections)
        {
            Rejections.Record(workspaceId, key);
            throw new QuestionRejected(text);
        }
        Rejections.Reset(workspaceId, key);
        return new JsonObject { ["degraded"] = true, ["validation"] = text };
    }

    /// <summary>Draws one option diagram after the node budget check; returns its diagram_ref.</summary>
    public async Task<JsonObject> DrawDiagram(string workspaceId, string title, IReadOnlyList<DiagramNode> nodes, IReadOnlyList<DiagramEdge> edges, string? questionId, string? optionId)
    {
        OptionDiagrams.Check(nodes, edges, title);
        var ws = _workspaceFor(workspaceId);
        var root = await Task.Run(() => QuestionStore.DrawDiagram(ws, title, nodes, edges, questionId, optionId));
        return new JsonObject { ["diagram_ref"] = root };
    }

    /// <summary>The settled answer, read from the broker or (after a restart) the canvas element.</summary>
    public async Task<JsonObject> Result(string workspaceId, string questionId)
    {
        var found = Broker.Lookup(questionId);
        if (found.Pending)
        {
            var ws = _workspaceFor(workspaceId);
            var element = await Task.Run(() => QuestionStore.FindElement(ws, questionId));
            found = (element is null ? null : QuestionStore.ResultFrom(element)) ?? found;
        }
        return found.ToToolJson();
    }

    /// <summary>One JSON-RPC request of the /mcp endpoint; null for a notification. A bad token raises BridgeException 401.</summary>
    public async Task<JsonObject?> HandleMcp(string? authorization, string? connection, JsonObject request, CancellationToken cancel = default)
    {
        var workspaceId = WorkspaceIdFor(McpJsonRpc.BearerToken(authorization));
        return await McpJsonRpc.Handle(request, ServerName, Instructions, Tools, (name, args) => CallTool(workspaceId, connection, name, args, cancel));
    }

    private static JsonObject Str(string description) => new() { ["type"] = "string", ["description"] = description };

    private static JsonArray Tools()
    {
        var option = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject
            {
                ["id"] = Str("unique within the question"), ["title"] = Str("short answer label"),
                ["description"] = Str("what this option means"), ["pro"] = Str("main advantage"), ["con"] = Str("main drawback"),
                ["rank"] = new JsonObject { ["type"] = "integer", ["description"] = "1 = your recommendation; ranks are unique" },
                ["why"] = Str("why it has this rank"), ["diagram_ref"] = Str("diagram_ref returned by draw_option_diagram"),
            },
            ["required"] = new JsonArray("id", "title", "description", "pro", "con", "why"),
        };
        var node = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject { ["id"] = Str("unique within the diagram"), ["label"] = Str("box label"), ["description"] = Str("optional detail"), ["status"] = Str("\"new\" for a part that does not exist yet") },
            ["required"] = new JsonArray("id", "label"),
        };
        var edge = new JsonObject
        {
            ["type"] = "object",
            ["properties"] = new JsonObject { ["from"] = Str("source node id"), ["to"] = Str("target node id"), ["label"] = Str("optional arrow label") },
            ["required"] = new JsonArray("from", "to"),
        };
        return new JsonArray(
            Tool("ask_user", "Ask the user a question on the canvas and wait for the answer (or a pending id).", new JsonObject
            {
                ["question"] = Str("the question text"),
                ["options"] = new JsonObject { ["type"] = "array", ["items"] = option },
                ["kind"] = new JsonObject { ["type"] = "string", ["enum"] = new JsonArray("choices", "diagram") },
                ["session_id"] = Str("shared by the questions of one grill session"),
                ["allow_custom"] = new JsonObject { ["type"] = "boolean" }, ["allow_skip"] = new JsonObject { ["type"] = "boolean" },
                ["total"] = new JsonObject { ["type"] = "integer", ["description"] = "planned number of questions in the session" },
            }, "question"),
            Tool("ask_user_result", "Fetch the answer of an earlier ask_user call that returned pending.", new JsonObject { ["question_id"] = Str("the pending question id") }, "question_id"),
            Tool("draw_option_diagram", DrawDescription, new JsonObject
            {
                ["title"] = Str("diagram title"),
                ["nodes"] = new JsonObject { ["type"] = "array", ["items"] = node },
                ["edges"] = new JsonObject { ["type"] = "array", ["items"] = edge },
                ["question_id"] = Str("attach the diagram to this question"), ["option_id"] = Str("the option of that question"),
            }, "title", "nodes"));
    }

    private async Task<JsonObject> CallTool(string workspaceId, string? connection, string name, JsonObject args, CancellationToken cancel)
    {
        try
        {
            switch (name)
            {
                case "ask_user":
                    return ToolResult(await Ask(workspaceId, AskRequest.FromJson(args), connection, cancel), false);
                case "ask_user_result":
                    if (Json.Str(args["question_id"]) is not { } questionId) return ToolText("question_id is required", true);
                    return ToolResult(await Result(workspaceId, questionId), false);
                case "draw_option_diagram":
                    if (Json.Str(args["title"]) is not { } title) return ToolText("title is required", true);
                    return ToolResult(await DrawDiagram(workspaceId, title, OptionDiagrams.ParseNodes(args["nodes"]), OptionDiagrams.ParseEdges(args["edges"]), Json.Str(args["question_id"]), Json.Str(args["option_id"])), false);
                default:
                    return ToolText($"unknown tool: {name}", true);
            }
        }
        catch (Exception error) when (error is QuestionWriteException or BridgeException)
        {
            return ToolText(error.Message, true);
        }
    }

}
