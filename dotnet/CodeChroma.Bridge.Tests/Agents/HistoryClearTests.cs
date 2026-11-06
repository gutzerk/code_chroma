using System.Net.Http.Headers;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Terminal;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Tests.Terminal;
using Microsoft.Extensions.DependencyInjection;
using static CodeChroma.Bridge.Tests.Support.FakeCliHarness;

namespace CodeChroma.Bridge.Tests.Agents;

/// <summary>Clearing a CLI's conversation drops the agent window's history at once, detected per provider.</summary>
public sealed class HistoryClearTests : IDisposable
{
    private readonly FakeCliHarness _cli = new();
    private readonly BridgeHost _host = new();

    public void Dispose()
    {
        _host.Dispose();
        _cli.Dispose();
    }

    private static StringContent Body(string json) => new(json, Encoding.UTF8, "application/json");

    private static JsonObject[] ChattyScript() => [.. Enumerable.Range(0, 60).Select(n => Stdout($"turn {n}")), Hang()];

    private static async Task WaitForHistory(AgentSession session)
    {
        var deadline = DateTime.UtcNow.AddSeconds(20);
        while (session.Screen.HistoryCount < 30 && DateTime.UtcNow < deadline) await Task.Delay(50);
    }

    /// <summary>Starts a claude agent whose fake CLI prints more lines than the screen holds, then waits for them to scroll into the history.</summary>
    private async Task<AgentSession> StartChattyClaude(string id)
    {
        JsonFile.Write(_host.Factory.Services.GetRequiredService<UserPaths>().Runtime, new JsonObject { ["cli_paths"] = new JsonObject { ["claude"] = _cli.ExePath } });
        _cli.Script(ChattyScript());
        var tab = await TerminalSocketTests.EnsureTab(_host);
        await _host.Client.PostAsync("/agents", Body($$"""{"title":"{{id}}","workspace":"{{tab}}"}"""));
        await _host.Client.PostAsync($"/agents/{id}/start", Body("{}"));
        var session = _host.Factory.Services.GetRequiredService<AgentSessionRegistry>().Get(id)!;
        await WaitForHistory(session);
        return session;
    }

    /// <summary>A session on the fake CLI that watches typed commands the way a codex window does.</summary>
    private async Task<AgentSession> StartTypedSession(ClearWatch clear)
    {
        _cli.Script(ChattyScript());
        var session = new AgentSession("typed", new PtyLaunch([_cli.ExePath], _cli.Directory), "codex", clear: clear);
        await WaitForHistory(session);
        return session;
    }

    private HttpRequestMessage Hook(string id, string json)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, $"/agents/{id}/hook") { Content = Body(json) };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _host.Factory.Services.GetRequiredService<QuestionMcp>().TokenFor(id));
        return request;
    }

    private static async Task<string> ReceiveUntil(WebSocket socket, Func<string, bool> done)
    {
        var buffer = new byte[16384];
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        while (true)
        {
            var result = await socket.ReceiveAsync(buffer, timeout.Token);
            var text = Encoding.UTF8.GetString(buffer, 0, result.Count);
            if (done(text)) return text;
        }
    }

    [Fact]
    public async Task A_clear_reported_by_claudes_SessionStart_hook_drops_the_history()
    {
        var session = await StartChattyClaude("talker");
        var before = session.Screen.HistoryCount;

        var reply = await _host.Client.SendAsync(Hook("talker", """{"hook_event_name":"SessionStart","source":"clear"}"""));

        Assert.True(reply.IsSuccessStatusCode);
        Assert.True(before >= 30, $"history before the clear: {before}");
        Assert.Equal(0, session.Screen.HistoryCount);
    }

    [Fact]
    public async Task A_resume_or_startup_SessionStart_keeps_the_history_and_the_status()
    {
        var session = await StartChattyClaude("keeper");

        await _host.Client.SendAsync(Hook("keeper", """{"hook_event_name":"SessionStart","source":"resume"}"""));

        Assert.True(session.Screen.HistoryCount >= 30);
        Assert.Equal(AgentStatus.Idle, session.Status);
    }

    [Fact]
    public async Task A_clear_erases_every_windows_scrollback_and_tells_the_canvas()
    {
        var session = await StartChattyClaude("shouter");
        var window = session.Attach();
        var events = await _host.Server.CreateWebSocketClient().ConnectAsync(new Uri("ws://localhost/repos/main/events"), CancellationToken.None);

        await _host.Client.SendAsync(Hook("shouter", """{"hook_event_name":"SessionStart","source":"clear"}"""));
        var pushed = JsonNode.Parse(await ReceiveUntil(events, text => text.Contains(AgentRuntime.HistoryClearedEvent)))!;
        var sent = new StringBuilder();
        while (window.Output.TryRead(out var chunk)) sent.Append(chunk);

        Assert.Equal((AgentRuntime.HistoryClearedEvent, "shouter"), ((string?)pushed["type"], (string?)pushed["id"]));
        Assert.Contains(AgentSession.ClearScrollback, sent.ToString());
    }

    [Fact]
    public async Task A_typed_clear_command_drops_the_history_of_a_cli_without_a_clear_hook()
    {
        using var session = await StartTypedSession(new ClearWatch(["/clear", "/new"], null));

        foreach (var key in "/new") session.Write(key.ToString());
        session.Write("\r");

        Assert.Equal(0, session.Screen.HistoryCount);
    }

    [Fact]
    public async Task Ordinary_typed_lines_keep_the_history()
    {
        using var session = await StartTypedSession(new ClearWatch(["/clear", "/new"], null));

        session.Write("/newer idea\r");
        session.Write("\u001b[A\r");

        Assert.True(session.Screen.HistoryCount >= 30);
    }

    [Theory]
    [InlineData("/clear\r", true)]
    [InlineData("  /clear  \r", true)]
    [InlineData("/clear my-name\r", true)]
    [InlineData("/clx\u007fear\r", true)]
    [InlineData("\u001b[200~/clear\u001b[201~\r", true)]
    [InlineData("/clearer\r", false)]
    [InlineData("please /clear\r", false)]
    [InlineData("/cl\t\r", false)]
    [InlineData("/clear\u001b[D\r", false)]
    [InlineData("/clear\u0015\r", false)]
    [InlineData("/clear", false)]
    public void The_typed_detector_matches_only_a_submitted_clear_command(string keys, bool cleared)
    {
        var detector = new TypedClearDetector(["/clear"]);

        var matched = keys.Select(key => detector.Feed(key.ToString())).Any(hit => hit);

        Assert.Equal(cleared, matched);
    }

    [Fact]
    public void An_edited_line_is_unknown_only_until_the_next_submit()
    {
        var detector = new TypedClearDetector(["/clear"]);
        detector.Feed("x\u001b[D\r");

        var matched = detector.Feed("/clear\r");

        Assert.True(matched);
    }

    [Fact]
    public void Each_adapter_defines_its_own_clear_commands()
    {
        var commands = CliAdapters.All.ToDictionary(kv => kv.Key, kv => string.Join(" ", kv.Value.ClearCommands));

        Assert.Equal("/clear /reset /new", commands["claude"]);
        Assert.Equal("/clear /new", commands["codex"]);
        Assert.Equal("/new /clear", commands["kimi-cli"]);
        Assert.Equal("/clear", commands["gemini"]);
    }

    [Fact]
    public void A_hooked_claude_launch_relies_on_the_hook_and_repaints_with_ctrl_l()
    {
        var agents = _host.Factory.Services.GetRequiredService<TerminalAgents>();

        var hooked = agents.Resolve("claude", agentId: "painter", bridgeUrl: "http://127.0.0.1:8123")!.Clear!;
        var unhooked = agents.Resolve("claude")!.Clear!;

        Assert.Equal((0, "\f"), (hooked.TypedCommands.Count, hooked.Repaint));
        Assert.Equal(["/clear", "/reset", "/new"], unhooked.TypedCommands);
        Assert.Null(agents.Resolve("shell")!.Clear);
    }

    [Fact]
    public void The_status_hooks_register_a_SessionStart_hook_only_for_clear()
    {
        var hooks = JsonNode.Parse(AgentSessionOwnership.HookSettings(statusHooks: true))!["hooks"]!;

        var clear = hooks["SessionStart"]!.AsArray().Single(e => (string?)e!["matcher"] == AgentHook.ClearSource)!;

        Assert.EndsWith(" " + AgentHook.Command, (string?)clear["hooks"]![0]!["command"]);
        Assert.Null(JsonNode.Parse(AgentSessionOwnership.HookSettings())!["hooks"]!["SessionStart"]!.AsArray()
            .FirstOrDefault(e => (string?)e!["matcher"] == AgentHook.ClearSource));
    }

    [Fact]
    public void The_hook_keeps_the_SessionStart_source()
    {
        var report = JsonNode.Parse("""{"hook_event_name":"SessionStart","source":"clear","session_id":"s","transcript_path":"/t.jsonl"}""")!.AsObject();

        var slim = AgentHook.Slim(report);

        Assert.Equal("""{"hook_event_name":"SessionStart","source":"clear"}""", slim.ToJsonString());
        Assert.True(AgentHook.IsClear(slim));
    }
}
