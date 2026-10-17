using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Live;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>Workspace status/activation and the live events socket; the terminal socket is TerminalRoutes.</summary>
public static class WorkspaceAndSocketRoutes
{
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
    }
}
