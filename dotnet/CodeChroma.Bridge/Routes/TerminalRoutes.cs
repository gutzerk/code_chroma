using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Channels;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Terminal;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>
/// WS /ws/terminal: a real pseudo-terminal bridged to a socket, or an attach to an agent's long-lived session. Frames carry a
/// one-character tag ("o" PTY output, "e" a JSON error envelope) so output that looks like JSON is never eaten. Closing the
/// socket kills a plain terminal's PTY but only detaches from an agent's: closing a window must never kill the agent.
/// </summary>
public static class TerminalRoutes
{
    public const int UnknownAgentCloseCode = 4404;
    public const int NoSessionCloseCode = 4409;
    private const string OutputTag = "o";
    private const string ErrorTag = "e";
    private const int MaxInputBytes = 4 * 1024 * 1024;

    public static void Map(WebApplication app, string repoRoot)
    {
        app.Map("/ws/terminal", async (HttpContext context, AgentSessionRegistry sessions, WorkspaceRegistry registry, AgentManager agents, IHostApplicationLifetime lifetime, Skills.RuntimeEnvironment runtime) =>
        {
            if (!context.WebSockets.IsWebSocketRequest) return Results.BadRequest();
            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted, lifetime.ApplicationStopping);
            var aborted = linked.Token;
            var agent = context.Request.Query["agent"].ToString();
            var workspace = context.Request.Query["workspace"].ToString();
            if (!TerminalAgents.Allowed.TryGetValue(agent, out var argv))
            {
                await Fail(socket, $"unknown agent: {agent}", UnknownAgentCloseCode);
                return Results.Empty;
            }
            var session = workspace.Length > 0 ? sessions.Get(workspace) : null;
            if (session is not null)
            {
                await BridgeManagedSession(socket, session, aborted);
                return Results.Empty;
            }
            if (NamesAnAgent(agents, workspace))
            {
                await Fail(socket, "the agent is not running", NoSessionCloseCode);
                return Results.Empty;
            }
            if (argv.Length == 0)
            {
                await Fail(socket, $"no executable configured for agent: {agent}", UnknownAgentCloseCode);
                return Results.Empty;
            }
            Dictionary<string, string> env;
            try { env = await runtime.TerminalEnvAsync(null, aborted); }
            catch (OperationCanceledException) { return Results.Empty; }
            await BridgeOwnPty(socket, argv, ResolveCwd(registry, repoRoot, workspace), env, aborted);
            return Results.Empty;
        });
    }

    /// <summary>True when the id names an agent workspace, so "not running" beats opening a bare shell.</summary>
    private static bool NamesAnAgent(AgentManager agents, string workspace)
    {
        if (workspace.Length == 0 || workspace == Workspace.MainId) return false;
        try { agents.Get(workspace); return true; }
        catch (UnknownAgentException) { return false; }
    }

    /// <summary>The named workspace's root when one is served, else the analyzed repo.</summary>
    private static string ResolveCwd(WorkspaceRegistry registry, string repoRoot, string workspace)
    {
        if (workspace.Length > 0 && registry.RootFor(workspace) is { Length: > 0 } root) return root;
        var configured = Environment.GetEnvironmentVariable("codechroma_BRIDGE_REPO_PATH");
        return string.IsNullOrEmpty(configured) ? repoRoot : Path.GetFullPath(configured, repoRoot);
    }

    /// <summary>A PTY that lives and dies with this socket: the plain terminal panel's behaviour.</summary>
    private static async Task BridgeOwnPty(WebSocket socket, string[] argv, string cwd, IReadOnlyDictionary<string, string> env, CancellationToken aborted)
    {
        var output = Channel.CreateUnbounded<string>();
        PtyHost host;
        try
        {
            host = PtyHost.Start(new PtyLaunch(argv, cwd, env), chunk => output.Writer.TryWrite(chunk), () => output.Writer.TryComplete());
        }
        catch (Exception error) when (error is not OutOfMemoryException)
        {
            await Fail(socket, $"could not start {argv[0]}: {error.Message}", UnknownAgentCloseCode);
            return;
        }
        using (host)
        {
            var pump = PumpOutput(socket, output.Reader, closeOnEnd: true);
            try { await ConsumeInput(socket, host.Write, host.Resize, host.WriteBytes, aborted); }
            finally
            {
                host.Close();
                output.Writer.TryComplete();
                await pump;
            }
        }
    }

    /// <summary>Attaches to an agent's long-lived PTY: redraw its current screen, then follow it live.</summary>
    private static async Task BridgeManagedSession(WebSocket socket, AgentSession session, CancellationToken aborted)
    {
        var consumer = session.Attach();
        var pump = PumpOutput(socket, consumer.Output, closeOnEnd: false);
        var resynced = false;
        try
        {
            await ConsumeInput(socket, session.Write, (rows, cols) =>
            {
                // the first resize is this window reporting its own geometry; redraw once at that size
                session.Resize(rows, cols);
                if (resynced) return;
                resynced = true;
                session.Resync(consumer);
            }, session.WriteBytes, aborted);
        }
        finally
        {
            // deliberately not session.Close(): closing a window must never kill the agent
            session.Detach(consumer);
            consumer.Channel.Writer.TryComplete();
            await pump;
            await CloseQuietly(socket);
        }
    }

    private static async Task PumpOutput(WebSocket socket, ChannelReader<string> reader, bool closeOnEnd)
    {
        try
        {
            await foreach (var chunk in reader.ReadAllAsync())
                await socket.SendAsync(Encoding.UTF8.GetBytes(OutputTag + chunk), WebSocketMessageType.Text, true, CancellationToken.None);
        }
        catch (Exception error) when (error is WebSocketException or ObjectDisposedException or InvalidOperationException or OperationCanceledException or IOException) { }
        finally
        {
            if (closeOnEnd) await CloseQuietly(socket);
        }
    }

    /// <summary>Reads input, binary and resize frames until the socket drops; unknown or malformed frames are ignored.</summary>
    private static async Task ConsumeInput(WebSocket socket, Action<string> write, Action<int, int> resize, Action<byte[]> writeBytes, CancellationToken aborted)
    {
        try
        {
            while (socket.State is WebSocketState.Open or WebSocketState.CloseSent)
            {
                var raw = await ReceiveText(socket, aborted);
                if (raw is null) return;
                JsonObject? message;
                try { message = JsonNode.Parse(raw) as JsonObject; }
                catch (JsonException) { continue; }
                switch (message?["type"]?.ToString())
                {
                    case "input":
                        write(message["data"]?.ToString() ?? "");
                        break;
                    case "binary":
                        // xterm's onBinary is raw bytes (mouse reports); base64 keeps them out of the JSON/UTF-8 hop
                        try { writeBytes(Convert.FromBase64String(message["data"]?.ToString() ?? "")); }
                        catch (FormatException) { }
                        break;
                    case "resize":
                        if (Dimension(message["rows"], 24) is { } rows && Dimension(message["cols"], 80) is { } cols) resize(rows, cols);
                        break;
                }
            }
        }
        catch (Exception error) when (error is WebSocketException or OperationCanceledException or ObjectDisposedException or IOException) { }
    }

    private static int? Dimension(JsonNode? node, int fallback)
    {
        if (node is null) return fallback;
        if (node is JsonValue value && value.TryGetValue<int>(out var number)) return Math.Clamp(number, 1, 1000);
        if (node is JsonValue text && text.TryGetValue<string>(out var s) && int.TryParse(s, out var parsed)) return Math.Clamp(parsed, 1, 1000);
        return null;
    }

    /// <summary>One whole text message, or null once the peer closed or sent more than the cap.</summary>
    private static async Task<string?> ReceiveText(WebSocket socket, CancellationToken aborted)
    {
        var buffer = new byte[16 * 1024];
        using var message = new MemoryStream();
        while (true)
        {
            var result = await socket.ReceiveAsync(buffer, aborted);
            if (result.MessageType == WebSocketMessageType.Close) return null;
            message.Write(buffer, 0, result.Count);
            if (message.Length > MaxInputBytes) return null;
            if (result.EndOfMessage) return Encoding.UTF8.GetString(message.GetBuffer(), 0, (int)message.Length);
        }
    }

    /// <summary>One error control frame the client renders inline, then a distinct close code.</summary>
    private static async Task Fail(WebSocket socket, string message, int code)
    {
        var frame = ErrorTag + new JsonObject { ["type"] = "error", ["message"] = message }.ToJsonString();
        try
        {
            await socket.SendAsync(Encoding.UTF8.GetBytes(frame), WebSocketMessageType.Text, true, CancellationToken.None);
            await socket.CloseOutputAsync((WebSocketCloseStatus)code, null, CancellationToken.None);
        }
        catch (Exception error) when (error is WebSocketException or ObjectDisposedException or InvalidOperationException or IOException or OperationCanceledException) { }
    }

    private static async Task CloseQuietly(WebSocket socket)
    {
        try
        {
            if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
                await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None);
        }
        catch (Exception error) when (error is WebSocketException or ObjectDisposedException or InvalidOperationException or IOException or OperationCanceledException) { }
    }
}
