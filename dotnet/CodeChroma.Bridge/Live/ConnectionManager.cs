using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Live;

/// <summary>Tracks connected canvas sockets (keyed by workspace id) and fans change pings out to them.</summary>
public class ConnectionManager
{
    private readonly Dictionary<WebSocket, string?> _connections = [];
    private readonly object _lock = new();

    public void Add(WebSocket socket, string? key)
    {
        lock (_lock) _connections[socket] = key;
    }

    public void Remove(WebSocket socket)
    {
        lock (_lock) _connections.Remove(socket);
    }

    public Task Broadcast(JsonNode message, string? key = null)
    {
        WebSocket[] targets;
        lock (_lock) targets = _connections.Where(c => key is null || c.Value == key).Select(c => c.Key).ToArray();
        if (targets.Length == 0) return Task.CompletedTask;
        var bytes = Encoding.UTF8.GetBytes(message.ToJsonString());
        return Task.WhenAll(targets.Select(socket => Send(socket, bytes)));
    }

    /// <summary>Broadcast from a watcher thread, where nobody awaits the result.</summary>
    public void BroadcastDetached(JsonNode message, string? key = null) => _ = Broadcast(message, key);

    private async Task Send(WebSocket socket, byte[] bytes)
    {
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(BridgeLimits.SocketSendTimeoutSeconds));
            await socket.SendAsync(bytes, WebSocketMessageType.Text, true, cts.Token);
        }
        catch (Exception)
        {
            // a socket that cannot take a ping is gone; it must not stall the others
            Remove(socket);
        }
    }
}

/// <summary>The trace-stream consumers, keyed by the raw repo id in the socket path (a separate set from the events sockets).</summary>
public sealed class TraceConnections : ConnectionManager;
