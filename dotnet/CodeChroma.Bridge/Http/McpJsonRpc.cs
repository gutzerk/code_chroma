using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Http;

/// <summary>The plain JSON-RPC pieces both bridge-hosted MCP endpoints (per-run steering, agent questions) share.</summary>
public static class McpJsonRpc
{
    /// <summary>The token of an `Authorization: Bearer ...` header, or null when absent or empty.</summary>
    public static string? BearerToken(string? authorization)
    {
        var token = (authorization ?? "").Trim();
        if (token.StartsWith("Bearer ", StringComparison.Ordinal)) token = token["Bearer ".Length..].Trim();
        return token.Length == 0 ? null : token;
    }

    /// <summary>The --mcp-config document for one http server with a bearer header.</summary>
    public static JsonObject HttpServerConfig(string server, string url, string token, int? timeoutMs = null)
    {
        var entry = new JsonObject
        {
            ["type"] = "http", ["url"] = url,
            ["headers"] = new JsonObject { ["Authorization"] = "Bearer " + token },
        };
        if (timeoutMs is { } timeout) entry["timeout"] = timeout;
        return new JsonObject { ["mcpServers"] = new JsonObject { [server] = entry } };
    }

    public static JsonObject Tool(string name, string description, JsonObject properties, params string[] required) => new()
    {
        ["name"] = name,
        ["description"] = description,
        ["inputSchema"] = new JsonObject { ["type"] = "object", ["properties"] = properties, ["required"] = new JsonArray(required.Select(r => (JsonNode?)r).ToArray()) },
    };

    public static JsonObject ToolText(string text, bool isError) => new()
    {
        ["content"] = new JsonArray(new JsonObject { ["type"] = "text", ["text"] = text }),
        ["isError"] = isError,
    };

    /// <summary>A tool result carrying the JSON both as text and as structured content.</summary>
    public static JsonObject ToolResult(JsonObject value, bool isError)
    {
        var result = ToolText(value.ToJsonString(), isError);
        result["structuredContent"] = value;
        return result;
    }

    /// <summary>Answers one request (initialize, tools/list, tools/call, ping); null for a notification (no id).</summary>
    public static async Task<JsonObject?> Handle(JsonObject request, string serverName, string? instructions, Func<JsonArray> tools, Func<string, JsonObject, Task<JsonObject>> call)
    {
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
                    ["serverInfo"] = new JsonObject { ["name"] = serverName, ["version"] = "1" },
                };
                if (instructions is not null) result["instructions"] = instructions;
                break;
            case "tools/list":
                result = new JsonObject { ["tools"] = tools() };
                break;
            case "tools/call":
                result = await call(Json.Str(parameters?["name"]) ?? "", parameters?["arguments"] as JsonObject ?? []);
                break;
            case "ping":
                result = new JsonObject();
                break;
            default:
                return new JsonObject { ["jsonrpc"] = "2.0", ["id"] = id, ["error"] = new JsonObject { ["code"] = -32601, ["message"] = "method not found" } };
        }
        return new JsonObject { ["jsonrpc"] = "2.0", ["id"] = id, ["result"] = result };
    }
}
