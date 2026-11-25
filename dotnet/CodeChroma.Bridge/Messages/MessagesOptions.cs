using System.Net.WebSockets;
using System.Text;

namespace CodeChroma.Bridge.Messages;

/// <summary>Endpoints, intervals and transports for the message sources; tests swap the handler and socket.</summary>
public sealed class MessagesOptions
{
    public Uri SlackApi { get; init; } = new("https://slack.com/api/");
    public Uri GraphApi { get; init; } = new("https://graph.microsoft.com/v1.0/");
    public Uri Login { get; init; } = new("https://login.microsoftonline.com/");

    /// <summary>Null uses the default network stack.</summary>
    public HttpMessageHandler? Handler { get; init; }

    public SocketConnector SlackSocket { get; init; } = ClientSocket.ConnectAsync;

    public TimeSpan OutlookPoll { get; init; } = TimeSpan.FromSeconds(60);

    /// <summary>Re-reads only the conversations that still hold unread items, so a read in Slack clears within this.</summary>
    public TimeSpan SlackOpenRecheck { get; init; } = TimeSpan.FromSeconds(60);

    /// <summary>The full every-conversation re-check, on top of the ones at start, reconnect and focus.</summary>
    public TimeSpan SlackFullRecheck { get; init; } = TimeSpan.FromMinutes(15);

    /// <summary>The minimum gap between two focus-triggered re-checks.</summary>
    public TimeSpan FocusThrottle { get; init; } = TimeSpan.FromSeconds(15);

    public int SlackConcurrency { get; init; } = 4;
    public int SlackMaxConversations { get; init; } = 1000;
    public int SlackMaxPerConversation { get; init; } = 20;
    public int OutlookMaxItems { get; init; } = 500;

    /// <summary>CodeChroma's own Entra public client id; null until the project registers one, so the user must supply theirs.</summary>
    public string? DefaultOutlookClientId { get; init; } = Environment.GetEnvironmentVariable("codechroma_OUTLOOK_CLIENT_ID") is { Length: > 0 } id ? id : null;

    public bool AutoStart { get; init; } = true;
}

/// <summary>Opens a text socket (Slack Socket Mode); a delegate so tests can script the frames.</summary>
public delegate Task<ISocketConnection> SocketConnector(Uri url, CancellationToken cancel);

/// <summary>A text-frame socket: null from ReceiveAsync means it closed.</summary>
public interface ISocketConnection : IAsyncDisposable
{
    Task<string?> ReceiveAsync(CancellationToken cancel);

    Task SendAsync(string text, CancellationToken cancel);
}

/// <summary>The real ClientWebSocket behind ISocketConnection.</summary>
public sealed class ClientSocket(ClientWebSocket socket) : ISocketConnection
{
    public static async Task<ISocketConnection> ConnectAsync(Uri url, CancellationToken cancel)
    {
        var socket = new ClientWebSocket();
        await socket.ConnectAsync(url, cancel);
        return new ClientSocket(socket);
    }

    public async Task<string?> ReceiveAsync(CancellationToken cancel)
    {
        var buffer = new byte[16 * 1024];
        using var message = new MemoryStream();
        while (true)
        {
            var result = await socket.ReceiveAsync(buffer, cancel);
            if (result.MessageType == WebSocketMessageType.Close) return null;
            message.Write(buffer, 0, result.Count);
            if (result.EndOfMessage) return Encoding.UTF8.GetString(message.ToArray());
        }
    }

    public Task SendAsync(string text, CancellationToken cancel) =>
        socket.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, true, cancel);

    public async ValueTask DisposeAsync()
    {
        try
        {
            if (socket.State == WebSocketState.Open)
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, null, timeout.Token);
            }
        }
        catch (Exception) { /* closing a dead socket */ }
        socket.Dispose();
    }
}

/// <summary>A failure the user can act on (bad token, revoked consent), with the HTTP status a route should answer.</summary>
public sealed class IntegrationException(string message, int status = 400) : Exception(message)
{
    public int Status { get; } = status;
}
