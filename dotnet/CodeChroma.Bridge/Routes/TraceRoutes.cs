using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Live;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>Recorded execution traces (.codechroma/traces) plus the producer/consumer socket pair a live trace run uses.</summary>
public static class TraceRoutes
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/repos/{repoId}/traces", (string repoId, WorkspaceRegistry registry) =>
            Reply.Json(new JsonArray(ListSummaries(registry.Get(repoId).TracesDir).Select(s => (JsonNode?)s).ToArray())));

        app.MapGet("/repos/{repoId}/traces/{traceId}", (string repoId, string traceId, WorkspaceRegistry registry) =>
            Reply.Json(Load(registry.Get(repoId).TracesDir, traceId)));

        app.Map("/repos/{repoId}/trace-stream", async (string repoId, HttpContext context, TraceConnections connections) =>
        {
            if (!context.WebSockets.IsWebSocketRequest) return Results.BadRequest();
            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            connections.Add(socket, repoId);
            try
            {
                var buffer = new byte[1024];
                while (socket.State == WebSocketState.Open)
                    if ((await socket.ReceiveAsync(buffer, context.RequestAborted)).MessageType == WebSocketMessageType.Close) break;
            }
            catch (Exception) { /* the socket is gone either way */ }
            finally { connections.Remove(socket); }
            return Results.Empty;
        });

        app.Map("/repos/{repoId}/trace-ingest", async (string repoId, HttpContext context, TraceConnections connections) =>
        {
            if (!context.WebSockets.IsWebSocketRequest) return Results.BadRequest();
            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            try
            {
                var buffer = new byte[16 * 1024];
                while (socket.State == WebSocketState.Open)
                {
                    var text = new StringBuilder();
                    WebSocketReceiveResult result;
                    do
                    {
                        result = await socket.ReceiveAsync(buffer, context.RequestAborted);
                        if (result.MessageType == WebSocketMessageType.Close) return Results.Empty;
                        text.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                    } while (!result.EndOfMessage);
                    await connections.Broadcast(JsonNode.Parse(text.ToString())!, repoId);
                }
            }
            catch (Exception) { /* a producer that drops or sends junk just ends the relay */ }
            return Results.Empty;
        });
    }

    /// <summary>Summaries of every trace file, newest first; a sidecar .meta.json avoids parsing every step.</summary>
    public static List<JsonObject> ListSummaries(string tracesDir)
    {
        if (!Directory.Exists(tracesDir)) return [];
        var files = Directory.GetFiles(tracesDir, "*.json").Where(p => !p.EndsWith(".meta.json", StringComparison.Ordinal))
            .Select(p => (Path: p, Time: File.GetLastWriteTimeUtc(p))).OrderByDescending(f => f.Time);
        var summaries = new List<JsonObject>();
        foreach (var (path, _) in files)
            if (Summarize(path) is { } summary) summaries.Add(summary);
        return summaries;
    }

    private static JsonObject? Summarize(string path)
    {
        var stem = Path.GetFileNameWithoutExtension(path);
        var meta = JsonFile.Load(Path.Combine(Path.GetDirectoryName(path)!, $"{stem}.meta.json"));
        JsonObject data;
        JsonArray? steps = null;
        if (meta is JsonObject m && m.ContainsKey("step_count")) data = m;
        else
        {
            if (JsonFile.Load(path) is not JsonObject whole || whole.Count == 0) return null;
            data = whole;
            steps = whole["steps"] as JsonArray;
        }
        return new JsonObject
        {
            ["id"] = data.ContainsKey("id") ? data["id"]?.DeepClone() : stem,
            ["entry"] = data.ContainsKey("entry") ? data["entry"]?.DeepClone() : "",
            ["created_at"] = data.ContainsKey("created_at") ? data["created_at"]?.DeepClone() : "",
            ["status"] = data.ContainsKey("status") ? data["status"]?.DeepClone() : "ok",
            ["step_count"] = data.ContainsKey("step_count") ? data["step_count"]?.DeepClone() : steps?.Count ?? 0,
        };
    }

    /// <summary>One trace by id with its steps ordered by seq; an id is a file name, never a traversal.</summary>
    public static JsonNode Load(string tracesDir, string traceId)
    {
        var trace = JsonFile.Load(Path.Combine(tracesDir, Path.GetFileName(traceId) + ".json"));
        if (trace is not JsonObject { Count: > 0 } obj) return trace ?? new JsonObject();
        obj["steps"] = obj["steps"] is JsonArray steps
            ? new JsonArray(steps.Select(s => s?.DeepClone()).OrderBy(Seq).ToArray())
            : new JsonArray();
        return obj;
    }

    private static double Seq(JsonNode? step) =>
        step is JsonObject o && o["seq"] is JsonValue v && v.GetValueKind() == JsonValueKind.Number ? v.GetValue<double>() : 0;
}
