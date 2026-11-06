using System.Net.Http.Headers;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Terminal;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Tests.Terminal;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using static CodeChroma.Bridge.Tests.Support.FakeCliHarness;

namespace CodeChroma.Bridge.Tests.Agents;

/// <summary>Exit is broadcast at once, a non-zero exit or failed start is the error status, and Claude launches carry the status hooks.</summary>
public sealed class AgentLifecycleStatusTests : IDisposable
{
    private readonly FakeCliHarness _cli = new();
    private readonly BridgeHost _host = new();

    public void Dispose()
    {
        _host.Dispose();
        _cli.Dispose();
    }

    private static StringContent Body(string json) => new(json, Encoding.UTF8, "application/json");

    private void UseCli(string path) =>
        JsonFile.Write(_host.Factory.Services.GetRequiredService<UserPaths>().Runtime, new JsonObject { ["cli_paths"] = new JsonObject { ["claude"] = path } });

    private async Task CreateAgent(string title, string? context = null)
    {
        var tab = await TerminalSocketTests.EnsureTab(_host);
        var extra = context is null ? "" : ",\"context\":" + JsonValue.Create(context).ToJsonString();
        await _host.Client.PostAsync("/agents", Body($$"""{"title":"{{title}}","workspace":"{{tab}}"{{extra}}}"""));
    }

    private async Task<JsonNode> PromptSubmit(string agentId)
    {
        var token = _host.Factory.Services.GetRequiredService<QuestionMcp>().TokenFor(agentId);
        var request = new HttpRequestMessage(HttpMethod.Post, $"/agents/{agentId}/hook") { Content = Body("""{"hook_event_name":"UserPromptSubmit"}""") };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return JsonNode.Parse(await (await _host.Client.SendAsync(request)).Content.ReadAsStringAsync())!;
    }

    private async Task<JsonNode> Agent()
    {
        var body = JsonNode.Parse(await _host.Client.GetStringAsync("/agents"))!;
        return body["agents"]![0]!;
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
    public async Task A_non_zero_exit_is_broadcast_at_once_as_an_error_until_dismissed()
    {
        _cli.Script(Exit(3));
        UseCli(_cli.ExePath);
        await CreateAgent("crasher");
        var socket = await _host.Server.CreateWebSocketClient().ConnectAsync(new Uri("ws://localhost/repos/main/events"), CancellationToken.None);

        await _host.Client.PostAsync("/agents/crasher/start", Body("{}"));
        var pushed = JsonNode.Parse(await ReceiveUntil(socket, text => text.Contains("\"status\":\"error\"")))!;
        var listed = await Agent();
        var dismissed = JsonNode.Parse(await (await _host.Client.PostAsync("/agents/crasher/dismiss-error", null)).Content.ReadAsStringAsync())!;

        Assert.Equal(("crasher", "error"), ((string?)pushed["id"], (string?)pushed["status"]));
        Assert.EndsWith("exited with code 3", (string?)pushed["error"]!["message"]);
        Assert.Equal("error", (string?)listed["status"]);
        Assert.Equal(("stopped", null), ((string?)dismissed["status"], dismissed["error"]));
    }

    [Fact]
    public async Task A_clean_exit_reads_as_stopped()
    {
        _cli.Script(Exit(0));
        UseCli(_cli.ExePath);
        await CreateAgent("finisher");
        var sessions = _host.Factory.Services.GetRequiredService<AgentSessionRegistry>();

        await _host.Client.PostAsync("/agents/finisher/start", Body("{}"));
        var deadline = DateTime.UtcNow.AddSeconds(20);
        while (sessions.Get("finisher")?.IsAlive == true && DateTime.UtcNow < deadline) await Task.Delay(50);

        Assert.Equal(("stopped", null), ((string?)(await Agent())["status"], (await Agent())["error"]));
    }

    [Fact]
    public async Task A_failed_auto_start_is_the_agents_error_and_a_successful_start_clears_it()
    {
        await CreateAgent("orphan");
        UseCli(Path.Combine(_cli.Directory, "missing-claude"));
        var runtime = _host.Factory.Services.GetServices<IHostedService>().OfType<AgentRuntime>().Single();

        await runtime.StartedAsync(CancellationToken.None);
        var failed = await Agent();
        _cli.Script(Hang());
        UseCli(_cli.ExePath);
        var started = JsonNode.Parse(await (await _host.Client.PostAsync("/agents/orphan/start", Body("{}"))).Content.ReadAsStringAsync())!;

        Assert.Equal("error", (string?)failed["status"]);
        Assert.Contains("missing-claude", (string?)failed["error"]!["message"]);
        Assert.NotEqual("error", (string?)started["status"]);
        Assert.Null(started["error"]);
    }

    [Fact]
    public async Task Hook_reports_drive_a_live_claude_agent_and_the_canvas_can_allow_a_permission()
    {
        _cli.Script(Hang());
        UseCli(_cli.ExePath);
        await CreateAgent("helper");
        await _host.Client.PostAsync("/agents/helper/start", Body("{}"));
        var token = _host.Factory.Services.GetRequiredService<QuestionMcp>().TokenFor("helper");
        HttpRequestMessage Hook(string json)
        {
            var request = new HttpRequestMessage(HttpMethod.Post, "/agents/helper/hook") { Content = Body(json) };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return request;
        }

        var waiting = _host.Client.SendAsync(Hook("""{"hook_event_name":"PermissionRequest","tool_name":"Bash","tool_input":{"command":"npm run e2e"}}"""));
        JsonNode? pending = null;
        for (var attempt = 0; attempt < 100 && pending is null; attempt++)
        {
            pending = (await Agent())["pending_permission"];
            if (pending is null) await Task.Delay(5);
        }
        var allowed = await _host.Client.PostAsync("/agents/helper/permission", Body($$"""{"request_id":"{{(string?)pending!["request_id"]}}","decision":"allow"}"""));
        var reply = JsonNode.Parse(await (await waiting).Content.ReadAsStringAsync())!;

        Assert.Equal("Bash(npm run e2e)", (string?)pending["summary"]);
        Assert.True(allowed.IsSuccessStatusCode);
        Assert.Equal("allow", (string?)reply["decision"]);
    }

    [Fact]
    public void A_bare_claude_launch_still_carries_the_status_hooks_and_their_token()
    {
        var agents = _host.Factory.Services.GetRequiredService<TerminalAgents>();
        var mcp = _host.Factory.Services.GetRequiredService<QuestionMcp>();

        var launch = agents.Resolve("claude", initialPrompt: "draw", bare: true, agentId: "painter", bridgeUrl: "http://127.0.0.1:8123")!;

        var argv = launch.Argv.ToList();
        Assert.Contains(AgentHook.Command, argv[argv.IndexOf("--settings") + 1]);
        Assert.Equal("painter", mcp.WorkspaceIdFor(launch.Env[McpEndpoint.TokenEnv]));
    }

    [Fact]
    public async Task A_view_context_is_never_typed_into_an_idle_claude_window()
    {
        _cli.Script(Stdout("\u001b]0;\u2733 Claude\u0007"), Hang());
        UseCli(_cli.ExePath);
        await CreateAgent("viewer", "the System context diagram");
        var sessions = _host.Factory.Services.GetRequiredService<AgentSessionRegistry>();

        await _host.Client.PostAsync("/agents/viewer/start", Body("{}"));
        var session = sessions.Get("viewer")!;
        var deadline = DateTime.UtcNow.AddSeconds(3);
        while (!session.Screen.Render().Contains("System context") && DateTime.UtcNow < deadline) await Task.Delay(100);

        Assert.True(session.DetectsIdle);
        Assert.DoesNotContain("System context", session.Screen.Render());
    }

    [Fact]
    public async Task Only_the_first_prompt_of_a_claude_window_carries_the_view_context()
    {
        _cli.Script(Hang());
        UseCli(_cli.ExePath);
        await CreateAgent("reader", "the System context diagram");
        await _host.Client.PostAsync("/agents/reader/start", Body("{}"));

        var first = await PromptSubmit("reader");
        var second = await PromptSubmit("reader");

        var context = (string?)first["additional_context"];
        Assert.Contains("the System context diagram", context);
        Assert.DoesNotContain("acknowledge", context, StringComparison.OrdinalIgnoreCase);
        Assert.Null(second["additional_context"]);
        Assert.True((bool?)second["ok"]);
    }

    [Fact]
    public void Only_the_claude_adapter_delivers_hidden_prompt_context()
    {
        var delivers = CodeChroma.Bridge.Skills.CliAdapters.All.Where(kv => kv.Value.HiddenPromptContext).Select(kv => kv.Key);

        Assert.Equal(["claude"], delivers);
    }
}
