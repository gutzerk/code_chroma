using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Tests.Support;

namespace CodeChroma.Bridge.Tests.Terminal;

/// <summary>The /ws/terminal socket against real shells: the old Python bridge closed it with 1000 about 20ms after open.</summary>
public class TerminalSocketTests
{
    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(20);
    private static string Newline => OperatingSystem.IsWindows() ? "\r" : "\n";

    private sealed class Client(WebSocket socket)
    {
        public WebSocket Socket { get; } = socket;
        public StringBuilder Output { get; } = new();
        public int? CloseCode { get; private set; }
        private readonly object _gate = new();

        public void StartReading() => _ = Task.Run(async () =>
        {
            var buffer = new byte[16 * 1024];
            try
            {
                while (true)
                {
                    var result = await Socket.ReceiveAsync(buffer, CancellationToken.None);
                    if (result.MessageType == WebSocketMessageType.Close) { lock (_gate) CloseCode = (int?)result.CloseStatus ?? 0; return; }
                    var text = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    lock (_gate) if (text.StartsWith('o')) Output.Append(text[1..]);
                }
            }
            catch (Exception) { lock (_gate) CloseCode ??= -1; }
        });

        /// <summary>Closes the window the way a browser tab does; the server may already have disposed its side.</summary>
        public async Task Leave()
        {
            try { await Socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, null, CancellationToken.None); }
            catch (Exception error) when (error is WebSocketException or ObjectDisposedException or IOException) { }
        }

        public string Text { get { lock (_gate) return Output.ToString(); } }

        public async Task<bool> WaitFor(string needle)
        {
            var deadline = DateTime.UtcNow + Patience;
            while (DateTime.UtcNow < deadline && !Text.Contains(needle, StringComparison.Ordinal)) await Task.Delay(50);
            return Text.Contains(needle, StringComparison.Ordinal);
        }

        public Task Send(object json) =>
            Socket.SendAsync(Encoding.UTF8.GetBytes(JsonNode.Parse(System.Text.Json.JsonSerializer.Serialize(json))!.ToJsonString()), WebSocketMessageType.Text, true, CancellationToken.None);
    }

    private static async Task<Client> Connect(BridgeHost host, string path)
    {
        var socket = await host.Server.CreateWebSocketClient().ConnectAsync(new Uri("ws://localhost" + path), CancellationToken.None);
        var client = new Client(socket);
        client.StartReading();
        return client;
    }

    /// <summary>The id of the first worktree tab, created by /branches/ensure.</summary>
    public static async Task<string> EnsureTab(BridgeHost host)
    {
        var response = await host.Client.PostAsync("/branches/ensure", null);
        return (string)JsonNode.Parse(await response.Content.ReadAsStringAsync())!["branches"]![0]!["id"]!;
    }

    [Fact]
    public async Task A_plain_shell_socket_echoes_input_resizes_and_stays_open_past_a_second()
    {
        using var host = new BridgeHost();
        var client = await Connect(host, "/ws/terminal?agent=shell");

        await Task.Delay(1500);
        await client.Send(new { type = "resize", rows = 30, cols = 100 });
        await client.Send(new { type = "input", data = "echo socket-marker-31" + Newline });

        Assert.True(await client.WaitFor("socket-marker-31"), client.Text);
        Assert.Null(client.CloseCode);
        Assert.Equal(WebSocketState.Open, client.Socket.State);
    }

    [Fact]
    public async Task Closing_a_plain_shell_socket_ends_its_process_but_an_agent_session_survives_the_window_closing()
    {
        using var host = new BridgeHost();
        var created = await host.Client.PostAsync("/agents", new StringContent($$"""{"title":"Live","kind":"shell","workspace":"{{await EnsureTab(host)}}"}""", Encoding.UTF8, "application/json"));
        Assert.True(created.IsSuccessStatusCode, await created.Content.ReadAsStringAsync());
        var started = await host.Client.PostAsync("/agents/live/start", new StringContent("{}", Encoding.UTF8, "application/json"));
        Assert.True(started.IsSuccessStatusCode, await started.Content.ReadAsStringAsync());
        var window = await Connect(host, "/ws/terminal?agent=shell&workspace=live");
        await window.Send(new { type = "input", data = "echo first-window-ok" + Newline });
        Assert.True(await window.WaitFor("first-window-ok"), window.Text);

        await window.Leave();
        await Task.Delay(500);
        var listing = JsonNode.Parse(await host.Client.GetStringAsync("/agents"))!;
        var second = await Connect(host, "/ws/terminal?agent=shell&workspace=live");
        await second.Send(new { type = "input", data = "echo second-window-ok" + Newline });

        Assert.NotEqual("stopped", (string?)listing["agents"]![0]!["status"]);
        Assert.NotEqual("exited", (string?)listing["agents"]![0]!["status"]);
        Assert.True(await second.WaitFor("second-window-ok"), second.Text);
        var stopped = await host.Client.PostAsync("/agents/live/stop", null);
        Assert.Equal("stopped", (string?)JsonNode.Parse(await stopped.Content.ReadAsStringAsync())!["status"]);
    }

    [Fact]
    public async Task A_reattaching_window_is_redrawn_from_the_screen_not_replayed()
    {
        using var host = new BridgeHost();
        await host.Client.PostAsync("/agents", new StringContent($$"""{"title":"Redraw","kind":"shell","workspace":"{{await EnsureTab(host)}}"}""", Encoding.UTF8, "application/json"));
        await host.Client.PostAsync("/agents/redraw/start", new StringContent("{}", Encoding.UTF8, "application/json"));
        var first = await Connect(host, "/ws/terminal?agent=shell&workspace=redraw");
        await first.Send(new { type = "input", data = "echo redraw-marker-9" + Newline });
        Assert.True(await first.WaitFor("redraw-marker-9"), first.Text);
        await first.Leave();

        var second = await Connect(host, "/ws/terminal?agent=shell&workspace=redraw");

        Assert.True(await second.WaitFor("redraw-marker-9"), second.Text);
        Assert.StartsWith("\u001b[?25l", second.Text);
        await host.Client.PostAsync("/agents/redraw/stop", null);
    }

    [Fact]
    public async Task Resuming_an_agent_with_no_recorded_session_is_a_409()
    {
        using var host = new BridgeHost();
        await host.Client.PostAsync("/agents", new StringContent($$"""{"title":"Fresh","kind":"shell","workspace":"{{await EnsureTab(host)}}"}""", Encoding.UTF8, "application/json"));
        var previous = Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR");
        Environment.SetEnvironmentVariable("CLAUDE_CONFIG_DIR", Path.Combine(Path.GetTempPath(), "cc-no-claude-" + Guid.NewGuid().ToString("N")[..6]));

        try
        {
            var response = await host.Client.PostAsync("/agents/fresh/start", new StringContent("""{"resume":true}""", Encoding.UTF8, "application/json"));

            Assert.Equal(System.Net.HttpStatusCode.Conflict, response.StatusCode);
            Assert.Contains("no recorded session to resume", await response.Content.ReadAsStringAsync());
        }
        finally { Environment.SetEnvironmentVariable("CLAUDE_CONFIG_DIR", previous); }
    }
}
