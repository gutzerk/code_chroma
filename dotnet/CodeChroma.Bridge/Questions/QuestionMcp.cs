using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Questions;

/// <summary>One MCP server for every workspace: the bearer token names and authorizes the workspace; `ask_user` blocks until the canvas answers.</summary>
public sealed class QuestionMcp(Func<string, Workspace> workspaceFor, TimeSpan? askWait = null, int maxRejections = 3)
{
    public const string SessionHeader = "Mcp-Session-Id";
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

    public QuestionBroker Broker { get; } = new();
    public RejectionTracker Rejections { get; } = new();

    /// <summary>How long `ask_user` blocks before returning pending.</summary>
    public TimeSpan AskWait { get; set; } = askWait ?? TimeSpan.FromSeconds(300);

    public int MaxRejections { get; set; } = maxRejections;

    /// <summary>The bearer token for one workspace: `workspace_id.hmac`; stable for this process.</summary>
    public string TokenFor(string workspaceId) => $"{workspaceId}.{Sign(workspaceId)}";

    /// <summary>What an agent window needs to reach /mcp.</summary>
    public McpEndpoint EndpointFor(string workspaceId, string baseUrl) => new(workspaceId, baseUrl, TokenFor(workspaceId));

    /// <summary>The workspace id a token names; throws QuestionAuthException if malformed or forged.</summary>
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

    /// <summary>The token of an `Authorization: Bearer` header, or null when absent or empty.</summary>
    public static string? BearerToken(string? header)
    {
        var token = (header ?? "").Trim();
        if (token.StartsWith("Bearer ", StringComparison.Ordinal)) token = token["Bearer ".Length..].Trim();
        return token.Length > 0 ? token : null;
    }

    private string Sign(string workspaceId) => Convert.ToHexString(HMACSHA256.HashData(_secret, Encoding.UTF8.GetBytes(workspaceId))).ToLowerInvariant();

    /// <summary>Opens the question on the canvas, blocks for the answer, or returns pending.</summary>
    public async Task<JsonObject> Ask(string workspaceId, AskRequest request, string? connection = null, CancellationToken cancellation = default)
    {
        var ws = workspaceFor(workspaceId);
        var extra = await Check(ws, workspaceId, request, connection);
        request.AgentId = workspaceId;
        var found = await Task.Run(() => QuestionStore.FindDiagramRequested(ws, request), cancellation);
        var reasked = found?.Keep;
        var questionId = reasked is not null ? Json.Str(reasked.Meta["question_id"])! : Guid.NewGuid().ToString("N");
        if (reasked is not null) Broker.Forget(questionId);
        Broker.Open(questionId);
        try
        {
            if (reasked is not null) await Task.Run(() => QuestionStore.Reask(ws, reasked, request, extra, found!.Value.Stale), cancellation);
            else await Task.Run(() => QuestionStore.OpenQuestion(ws, request, questionId, extra), cancellation);
            var result = await Broker.Wait(questionId, AskWait, cancellation);
            return result.ToToolJson();
        }
        catch
        {
            Broker.Close(questionId);
            throw;
        }
    }

    /// <summary>Throws QuestionRejected on a contract break; at the retry limit lets one through degraded.</summary>
    private async Task<JsonObject?> Check(Workspace ws, string workspaceId, AskRequest request, string? connection)
    {
        if (request.Degraded) return new JsonObject { ["degraded"] = true };
        var problems = QuestionValidation.Validate(request);
        if (problems.Count == 0 && request.Options.Any(o => !string.IsNullOrEmpty(o.DiagramRef)))
            problems = QuestionValidation.UnknownRefs(request, await Task.Run(() => QuestionStore.KnownElementIds(ws)));
        var key = !string.IsNullOrEmpty(request.SessionId) ? request.SessionId : !string.IsNullOrEmpty(connection) ? "conn:" + connection : null;
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

    /// <summary>Draws one option diagram after the node budget check; returns its `diagram_ref`.</summary>
    public async Task<JsonObject> DrawDiagram(string workspaceId, string title, IReadOnlyList<DiagramNode> nodes, IReadOnlyList<DiagramEdge> edges, string? questionId, string? optionId)
    {
        QuestionDiagrams.Check(nodes, edges, title);
        var ws = workspaceFor(workspaceId);
        var root = await Task.Run(() => QuestionStore.DrawDiagram(ws, title, nodes, edges, questionId, optionId));
        return new JsonObject { ["diagram_ref"] = root };
    }

    /// <summary>The settled answer, read from the broker or (after a restart) the canvas element.</summary>
    public async Task<JsonObject> Result(string workspaceId, string questionId)
    {
        var found = Broker.Lookup(questionId);
        if (found.Pending)
        {
            var ws = workspaceFor(workspaceId);
            var element = await Task.Run(() => QuestionStore.FindElement(ws, questionId));
            if (element is not null && QuestionStore.ResultFrom(element) is { } settled) found = settled;
        }
        return found.ToToolJson();
    }

    /// <summary>One JSON-RPC request of the MCP endpoint; null for a notification.</summary>
    public async Task<JsonObject?> HandleMcp(string? bearer, JsonObject request, string? connection = null, CancellationToken cancellation = default)
    {
        var workspaceId = WorkspaceIdFor(BearerToken(bearer));
        var id = request["id"]?.DeepClone();
        var method = Json.Str(request["method"]) ?? "";
        var parameters = request["params"] as JsonObject;
        if (id is null) return null;
        JsonObject result;
        switch (method)
        {
            case "initialize":
                result = new JsonObject
                {
                    ["protocolVersion"] = Json.Str(parameters?["protocolVersion"]) ?? "2025-03-26",
                    ["capabilities"] = new JsonObject { ["tools"] = new JsonObject() },
                    ["serverInfo"] = new JsonObject { ["name"] = McpEndpoint.ServerName, ["version"] = "1" },
                    ["instructions"] = Instructions,
                };
                break;
            case "tools/list":
                result = new JsonObject { ["tools"] = Tools() };
                break;
            case "tools/call":
                result = await CallTool(workspaceId, Json.Str(parameters?["name"]) ?? "", parameters?["arguments"] as JsonObject ?? [], connection, cancellation);
                break;
            case "ping":
                result = new JsonObject();
                break;
            default:
                return new JsonObject { ["jsonrpc"] = "2.0", ["id"] = id, ["error"] = new JsonObject { ["code"] = -32601, ["message"] = "method not found" } };
        }
        return new JsonObject { ["jsonrpc"] = "2.0", ["id"] = id, ["result"] = result };
    }

    private async Task<JsonObject> CallTool(string workspaceId, string name, JsonObject args, string? connection, CancellationToken cancellation)
    {
        try
        {
            JsonObject outcome;
            switch (name)
            {
                case "ask_user":
                    outcome = await Ask(workspaceId, AskRequest.FromJson(args), connection, cancellation);
                    break;
                case "ask_user_result":
                    outcome = await Result(workspaceId, ArgReader.Required(args, "question_id", "ask_user_result"));
                    break;
                case "draw_option_diagram":
                    outcome = await DrawDiagram(
                        workspaceId, ArgReader.Required(args, "title", "draw_option_diagram"), QuestionDiagrams.ParseNodes(args["nodes"]),
                        QuestionDiagrams.ParseEdges(args["edges"]), ArgReader.OptionalText(args, "question_id", "draw_option_diagram"), ArgReader.OptionalText(args, "option_id", "draw_option_diagram"));
                    break;
                default:
                    return ToolResult($"unknown tool: {name}", null, true);
            }
            return ToolResult(outcome.ToJsonString(), outcome, false);
        }
        catch (Exception error) when (error is QuestionRejected or QuestionWriteException or BridgeException)
        {
            return ToolResult(error.Message, null, true);
        }
    }

    private static JsonObject ToolResult(string text, JsonObject? structured, bool isError)
    {
        var result = new JsonObject { ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = text }), ["isError"] = isError };
        if (structured is not null) result["structuredContent"] = structured.DeepClone();
        return result;
    }

    private static JsonArray Tools()
    {
        var option = Obj(
            ("id", Str()), ("title", Str()), ("description", Str()), ("pro", Str()), ("con", Str()),
            ("rank", new JsonObject { ["type"] = "integer" }), ("why", Str()), ("diagram_ref", Str()));
        option["required"] = new JsonArray("id", "title");
        var node = Obj(("id", Str()), ("label", Str()), ("description", Str()), ("status", Str()));
        node["required"] = new JsonArray("id", "label");
        var edge = Obj(("from", Str()), ("to", Str()), ("label", Str()));
        edge["required"] = new JsonArray("from", "to");
        return new JsonArray(
            Tool("ask_user", "Ask the user a question on the canvas and wait for the answer (or a pending id).",
                Obj(
                    ("question", Str()), ("options", new JsonObject { ["type"] = "array", ["items"] = option }),
                    ("kind", new JsonObject { ["type"] = "string", ["enum"] = new JsonArray("choices", "diagram") }),
                    ("session_id", Str()), ("allow_custom", new JsonObject { ["type"] = "boolean" }),
                    ("allow_skip", new JsonObject { ["type"] = "boolean" }), ("total", new JsonObject { ["type"] = "integer" })),
                "question"),
            Tool("ask_user_result", "Fetch the answer of an earlier ask_user call that returned pending.", Obj(("question_id", Str())), "question_id"),
            Tool("draw_option_diagram", DrawDescription,
                Obj(
                    ("title", Str()), ("nodes", new JsonObject { ["type"] = "array", ["items"] = node }),
                    ("edges", new JsonObject { ["type"] = "array", ["items"] = edge }), ("question_id", Str()), ("option_id", Str())),
                "title", "nodes"));
    }

    private static JsonObject Str() => new() { ["type"] = "string" };

    private static JsonObject Obj(params (string Name, JsonObject Schema)[] properties)
    {
        var props = new JsonObject();
        foreach (var (name, schema) in properties) props[name] = schema;
        return new JsonObject { ["type"] = "object", ["properties"] = props };
    }

    private static JsonObject Tool(string name, string description, JsonObject schema, params string[] required)
    {
        schema["required"] = new JsonArray(required.Select(r => (JsonNode?)r).ToArray());
        return new JsonObject { ["name"] = name, ["description"] = description, ["inputSchema"] = schema };
    }
}
