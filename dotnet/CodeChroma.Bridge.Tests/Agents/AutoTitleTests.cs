using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Live;
using CodeChroma.Bridge.Routes;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Tests.Terminal;
using Microsoft.Extensions.DependencyInjection;

namespace CodeChroma.Bridge.Tests.Agents;

/// <summary>Agents name themselves from their claude session (custom title, ai-title, first prompt) unless the user renamed them by hand.</summary>
public sealed class AutoTitleTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "cc-autotitle-" + Guid.NewGuid().ToString("N")[..8]);

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private static string User(string content, bool meta = false, bool sidechain = false) =>
        new JsonObject
        {
            ["type"] = "user", ["isMeta"] = meta, ["isSidechain"] = sidechain, ["cwd"] = "/work/tree", ["sessionId"] = "s1",
            ["message"] = new JsonObject { ["role"] = "user", ["content"] = content },
        }.ToJsonString();

    private static string AiTitle(string title) => new JsonObject { ["type"] = "ai-title", ["aiTitle"] = title, ["sessionId"] = "s1" }.ToJsonString();

    private static string CustomTitle(string title) => new JsonObject { ["type"] = "custom-title", ["customTitle"] = title, ["sessionId"] = "s1" }.ToJsonString();

    private string Transcript(params string[] lines)
    {
        var dir = Path.Combine(_root, "-work-tree");
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, "s1.jsonl");
        File.WriteAllText(path, string.Concat(lines.Select(l => l + "\n")));
        return path;
    }

    private static AgentRecord Record(string contextKind = "view", string? diagramRequest = null, string kind = "claude") =>
        new() { Id = "a1", Title = "a1", Kind = kind, Branch = "b", Worktree = "/work/tree", CreatedAt = "2026-11-09T00:00:00Z", ContextKind = contextKind, DiagramRequest = diagramRequest };

    [Theory]
    [InlineData("fix the token refresh race now", "Fix the token refresh race now")]
    [InlineData("please refactor the payment module so that retries are idempotent", "Please refactor the payment module so…")]
    [InlineData("посмотри задачу https://jira.example.com/browse/GDATA-6898", "Посмотри задачу GDATA-6898")]
    [InlineData("\n\n  add dark mode\nand also tests", "Add dark mode")]
    [InlineData("   ", null)]
    public void A_heuristic_title_is_a_few_words_of_the_first_line_in_its_own_language(string prompt, string? expected)
    {
        var title = AutoTitle.Heuristic(prompt);

        Assert.Equal(expected, title);
    }

    [Fact]
    public void A_long_title_is_cut_at_a_word_with_an_ellipsis()
    {
        var text = string.Join(' ', Enumerable.Repeat("word", 30));

        var shortened = AutoTitle.Shorten(text, AutoTitle.MaxChars)!;

        Assert.True(shortened.Length <= AutoTitle.MaxChars, shortened);
        Assert.EndsWith("word…", shortened);
    }

    [Fact]
    public void The_custom_title_beats_claudes_ai_title_which_beats_the_first_prompt()
    {
        var path = Transcript(User("Caveat", meta: true), User("[Context] You were just launched"), User("add retries to the uploader"), AiTitle("Uploader retries"), CustomTitle("Retry work"), AiTitle("Uploader retry policy"));

        var topic = AutoTitle.Read(path);

        Assert.Equal(new SessionTopic("Retry work", "Uploader retry policy", "add retries to the uploader"), topic);
        Assert.Equal("Retry work", AutoTitle.Choose(topic, Record()));
        Assert.Equal("Uploader retry policy", AutoTitle.Choose(topic with { Custom = null }, Record()));
        Assert.Equal("Add retries to the uploader", AutoTitle.Choose(topic with { Custom = null, AiTitle = null }, Record()));
    }

    [Fact]
    public void A_transcript_is_followed_so_a_later_ai_title_is_picked_up()
    {
        var path = Transcript(User("draw the login flow"));
        var before = AutoTitle.Read(path);
        File.AppendAllText(path, AiTitle("Login flow diagram") + "\n" + "{\"type\":\"ai-title\",\"aiTi");

        var after = AutoTitle.Read(path);

        Assert.Equal((null, "draw the login flow"), (before.AiTitle, before.Opening));
        Assert.Equal(("Login flow diagram", "draw the login flow"), (after.AiTitle, after.Opening));
    }

    [Fact]
    public void A_task_agent_is_named_from_its_request_never_from_the_composed_skill_prompt()
    {
        var topic = new SessionTopic(null, null, "You are drawing a CodeChroma diagram. Follow the skill below...");

        var withRequest = AutoTitle.Choose(topic, Record("task", "show how checkout talks to Stripe"));
        var withoutRequest = AutoTitle.Choose(topic, Record("task"));

        Assert.Equal("Show how checkout talks to Stripe", withRequest);
        Assert.Null(withoutRequest);
    }

    [Fact]
    public void An_agent_without_a_claude_session_gets_no_suggestion()
    {
        Transcript(AiTitle("Should not be read"));

        var title = AutoTitle.Suggest(Record(kind: "shell"), () => "s1", _root);

        Assert.Null(title);
    }

    [Fact]
    public void A_hand_rename_locks_the_title_and_clearing_it_hands_the_agent_back()
    {
        var repo = Path.Combine(_root, "repo");
        Directory.CreateDirectory(Path.Combine(repo, ".codechroma"));
        File.WriteAllText(Path.Combine(repo, ".codechroma", "agents.json"),
            new JsonObject { ["version"] = 1, ["agents"] = new JsonArray(Record().ToJson()) }.ToJsonString());
        var manager = new AgentManager(repo);
        var autoSource = manager.ApplyAutoTitle("a1", "Uploader retries")?.TitleSource;
        manager.Rename("a1", "  My  name ");
        var blocked = manager.ApplyAutoTitle("a1", "Something else");
        var reloaded = new AgentManager(repo).Get("a1");
        manager.Rename("a1", "");

        Assert.Equal(AutoTitle.AutoSource, autoSource);
        Assert.Null(blocked);
        Assert.Equal(("My name", AutoTitle.UserSource), (reloaded.Title, reloaded.TitleSource));
        Assert.Equal(("a1", AutoTitle.DefaultSource), (manager.Get("a1").Title, manager.Get("a1").TitleSource));
    }

    [Fact]
    public async Task A_rename_route_and_an_auto_title_both_reach_the_canvas()
    {
        using var host = new BridgeHost();
        var tab = await TerminalSocketTests.EnsureTab(host);
        await host.Client.PostAsync("/agents", new StringContent($$"""{"title":"","workspace":"{{tab}}"}""", Encoding.UTF8, "application/json"));
        var agents = host.Factory.Services.GetRequiredService<AgentManager>();
        var record = agents.List().Single();
        record.SessionId = "s1";
        var dir = Path.Combine(_root, "-tree");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "s1.jsonl"), User("ship the release notes") + "\n" + AiTitle("Release notes") + "\n");
        var events = await host.Server.CreateWebSocketClient().ConnectAsync(new Uri("ws://localhost/repos/main/events"), CancellationToken.None);
        var connections = host.Factory.Services.GetRequiredService<ConnectionManager>();

        AgentRoutes.ScheduleAutoTitle(agents, connections, record, _root);
        var pushed = JsonNode.Parse(await ReceiveTitle(events))!;
        var renamed = await host.Client.PatchAsync($"/agents/{record.Id}", new StringContent("""{"title":"Mine"}""", Encoding.UTF8, "application/json"));
        var renamedPush = JsonNode.Parse(await ReceiveTitle(events))!;
        var invalid = await host.Client.PatchAsync($"/agents/{record.Id}", new StringContent("""{"title":5}""", Encoding.UTF8, "application/json"));
        var missing = await host.Client.PatchAsync("/agents/nope", new StringContent("""{"title":"x"}""", Encoding.UTF8, "application/json"));

        Assert.Equal(("Release notes", "auto"), ((string?)pushed["title"], (string?)pushed["title_source"]));
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        Assert.Equal(("Mine", "user"), ((string?)renamedPush["title"], (string?)renamedPush["title_source"]));
        Assert.Equal((HttpStatusCode.BadRequest, HttpStatusCode.NotFound), (invalid.StatusCode, missing.StatusCode));
    }

    private static async Task<string> ReceiveTitle(WebSocket socket)
    {
        var buffer = new byte[16384];
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        while (true)
        {
            var result = await socket.ReceiveAsync(buffer, timeout.Token);
            var text = Encoding.UTF8.GetString(buffer, 0, result.Count);
            if (text.Contains(AutoTitle.TitleEvent)) return text;
        }
    }
}
