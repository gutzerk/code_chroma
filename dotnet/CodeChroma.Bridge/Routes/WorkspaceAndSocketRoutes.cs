using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Live;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>Workspace status/activation, the live events socket, and the terminal socket's tagged error frames.</summary>
public static class WorkspaceAndSocketRoutes
{
    private const int UnknownAgentCloseCode = 4404;
    private const int NotImplementedCloseCode = 1011;
    private const string ErrorTag = "e";

    private static readonly Dictionary<string, string[]> AllowedAgents = new()
    {
        ["shell"] = [OperatingSystem.IsWindows() ? "cmd.exe" : "/bin/bash"],
        ["claude"] = ["claude"],
        ["agent"] = [],
    };

    public static void Map(WebApplication app, string repoRoot)
    {
        app.MapGet("/health", () => Results.Json(new Health("ok", repoRoot), BridgeJson.Default.Health));

        app.MapGet("/workspaces/{id}/status", (string id, WorkspaceRegistry registry) =>
        {
            var state = registry.State(id);
            return Results.Json(new WorkspaceStatus(id, state.State, state.Progress, state.Error, registry.IsReadOnly(id)), BridgeJson.Default.WorkspaceStatus);
        });

        app.MapPost("/workspaces/{id}/activate", (string id, WorkspaceRegistry registry) =>
        {
            if (id != Workspace.MainId && !registry.IsRegistered(id))
                return Results.Json(new ErrorDetail($"unknown workspace: {id}"), BridgeJson.Default.ErrorDetail, statusCode: 404);
            var state = registry.EnsureAsync(id);
            return Results.Json(new WorkspaceActivation(id, state.State, state.Progress, state.Error), BridgeJson.Default.WorkspaceActivation);
        });

        app.Map("/repos/{repoId}/events", async (string repoId, HttpContext context, WorkspaceRegistry registry, ConnectionManager connections) =>
        {
            if (!context.WebSockets.IsWebSocketRequest) return Results.BadRequest();
            var key = (await Task.Run(() => registry.Get(repoId))).Id;
            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            connections.Add(socket, key);
            try
            {
                var buffer = new byte[1024];
                while (socket.State == WebSocketState.Open)
                {
                    var result = await socket.ReceiveAsync(buffer, context.RequestAborted);
                    if (result.MessageType == WebSocketMessageType.Close) break;
                }
            }
            catch (Exception) { /* the socket is gone either way */ }
            finally { connections.Remove(socket); }
            return Results.Empty;
        });

        app.Map("/ws/terminal", async (HttpContext context) =>
        {
            if (!context.WebSockets.IsWebSocketRequest) return Results.BadRequest();
            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            var agent = context.Request.Query["agent"].ToString();
            if (!AllowedAgents.TryGetValue(agent, out var argv))
                await Fail(socket, $"unknown agent: {agent}", UnknownAgentCloseCode);
            else if (argv.Length == 0)
                await Fail(socket, $"no executable configured for agent: {agent}", UnknownAgentCloseCode);
            else
                await Fail(socket, "the PTY terminal host is not ported to the C# bridge yet", NotImplementedCloseCode);
            return Results.Empty;
        });
    }

    /// <summary>One error control frame (tag "e" + JSON) the client renders inline, then a distinct close code.</summary>
    private static async Task Fail(WebSocket socket, string message, int code)
    {
        var frame = ErrorTag + new JsonObject { ["type"] = "error", ["message"] = message }.ToJsonString();
        await socket.SendAsync(Encoding.UTF8.GetBytes(frame), WebSocketMessageType.Text, true, CancellationToken.None);
        await socket.CloseOutputAsync((WebSocketCloseStatus)code, null, CancellationToken.None);
    }
}
