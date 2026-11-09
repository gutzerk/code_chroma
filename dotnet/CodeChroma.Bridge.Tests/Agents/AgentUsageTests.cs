using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Tests.Support;

namespace CodeChroma.Bridge.Tests.Agents;

/// <summary>The agents full-screen usage strip: transcript totals, cache hit, context window and the usage route.</summary>
public sealed class AgentUsageTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "cc-usage-" + Guid.NewGuid().ToString("N")[..8]);

    private string NoCatalog => Path.Combine(_root, "no-catalog");

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private static string Reply(string id, string model, int input, int cacheRead, int cacheWrite, int output, bool sidechain = false) =>
        new JsonObject
        {
            ["type"] = "assistant", ["isSidechain"] = sidechain, ["sessionId"] = "s1",
            ["message"] = new JsonObject
            {
                ["id"] = id, ["model"] = model,
                ["usage"] = new JsonObject { ["input_tokens"] = input, ["cache_read_input_tokens"] = cacheRead, ["cache_creation_input_tokens"] = cacheWrite, ["output_tokens"] = output },
            },
        }.ToJsonString();

    private AgentRecord Agent(string kind, params string[] lines)
    {
        Directory.CreateDirectory(Path.Combine(_root, "C--work-tree"));
        File.WriteAllLines(Path.Combine(_root, "C--work-tree", "s1.jsonl"), lines);
        return new AgentRecord { Id = "a1", Title = "A", Kind = kind, Branch = "b", Worktree = "C:/work/tree", CreatedAt = "2026-10-22T00:00:00Z" };
    }

    [Fact]
    public void Usage_sums_every_reply_once()
    {
        var record = Agent("claude",
            """{"type":"user","cwd":"C:/work/tree","sessionId":"s1","message":{"content":"hi"}}""",
            Reply("m1", "claude-opus-5-5", 100_000, 0, 20_000, 4_000),
            Reply("m1", "claude-opus-5-5", 100_000, 0, 20_000, 4_000),
            Reply("m2", "claude-opus-5-5", 2_000, 110_000, 8_000, 6_000),
            Reply("m3", "claude-haiku-5-5", 1_000, 9_000, 0, 500, sidechain: true),
            Reply("m4", "<synthetic>", 0, 0, 0, 0));

        var usage = AgentUsage.Read(record, () => "s1", _root, NoCatalog)!;

        Assert.Equal(120_000, usage["contextTokens"]!.GetValue<long>());
        Assert.Equal(ModelSpecs.LongContextWindow, usage["contextWindow"]!.GetValue<long>());
        Assert.Equal(250_000, usage["inputTokens"]!.GetValue<long>());
        Assert.Equal(10_500, usage["outputTokens"]!.GetValue<long>());
        Assert.Equal(119_000, usage["cacheReadTokens"]!.GetValue<long>());
        Assert.Equal(0.476, usage["cacheHitRatio"]!.GetValue<double>());
    }

    [Fact]
    public void A_reply_streamed_as_several_entries_counts_its_final_output()
    {
        var record = Agent("claude",
            Reply("m1", "claude-opus-5-5", 10, 1_000, 0, 5),
            Reply("m1", "claude-opus-5-5", 10, 1_000, 0, 900));

        var usage = AgentUsage.Read(record, () => "s1", _root, NoCatalog)!;

        Assert.Equal(900, usage["outputTokens"]!.GetValue<long>());
    }

    [Fact]
    public void Subagent_transcripts_add_to_the_totals_but_not_the_context()
    {
        var record = Agent("claude", Reply("m1", "claude-opus-5-5", 10, 1_000, 0, 50));
        Directory.CreateDirectory(Path.Combine(_root, "C--work-tree", "s1", "subagents"));
        File.WriteAllLines(Path.Combine(_root, "C--work-tree", "s1", "subagents", "agent-a1.jsonl"), [Reply("m2", "claude-haiku-5-5", 20, 9_000, 0, 300)]);

        var usage = AgentUsage.Read(record, () => "s1", _root, NoCatalog)!;

        Assert.Equal(1_010, usage["contextTokens"]!.GetValue<long>());
        Assert.Equal(10_030, usage["inputTokens"]!.GetValue<long>());
        Assert.Equal(350, usage["outputTokens"]!.GetValue<long>());
    }

    [Fact]
    public void A_context_past_the_default_window_reports_the_long_window()
    {
        var record = Agent("claude", Reply("m1", "claude-opus-5-5", 10, 300_000, 0, 50));

        var usage = AgentUsage.Read(record, () => "s1", _root, NoCatalog)!;

        Assert.Equal(ModelSpecs.LongContextWindow, usage["contextWindow"]!.GetValue<long>());
    }

    [Fact]
    public void An_unknown_model_keeps_its_tokens()
    {
        var record = Agent("claude", Reply("m1", "claude-unknown-9", 1_000, 3_000, 0, 50));

        var usage = AgentUsage.Read(record, () => "s1", _root, NoCatalog)!;

        Assert.Equal(4_000, usage["inputTokens"]!.GetValue<long>());
        Assert.Equal(0.75, usage["cacheHitRatio"]!.GetValue<double>());
    }

    [Theory]
    [InlineData("claude", null)]
    [InlineData("codex", "s1")]
    public void No_session_or_a_non_claude_agent_has_no_usage(string kind, string? session)
    {
        var record = Agent(kind, Reply("m1", "claude-opus-5-5", 1, 1, 1, 1));

        var usage = AgentUsage.Read(record, () => session, _root, NoCatalog);

        Assert.Null(usage);
    }

    [Fact]
    public void An_agent_window_launched_as_claude_has_usage()
    {
        var record = Agent("agent", Reply("m1", "claude-opus-5-5", 1, 1, 1, 1));
        record.SessionTrackingId = Guid.NewGuid().ToString();

        var usage = AgentUsage.Read(record, () => "s1", _root, NoCatalog);

        Assert.NotNull(usage);
    }

    [Theory]
    [InlineData("claude-sonnet-5-5", ModelSpecs.LongContextWindow)]
    [InlineData("claude-opus-5-5-20260301", ModelSpecs.LongContextWindow)]
    [InlineData("claude-opus-7", ModelSpecs.LongContextWindow)]
    [InlineData("claude-haiku-4-5-20251001", ModelSpecs.DefaultContextWindow)]
    [InlineData("claude-3-5-sonnet-20241022", ModelSpecs.DefaultContextWindow)]
    public void Without_a_cached_catalog_a_model_id_finds_its_fallback_window(string model, long window)
    {
        var actual = ModelSpecs.ContextWindow(model, catalogDir: NoCatalog);

        Assert.Equal(window, actual);
    }

    [Fact]
    public void The_newest_cached_catalog_sets_the_window()
    {
        var dir = Path.Combine(_root, "model-catalog");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "old-cc.json"), """{"fetchedAt":1,"catalog":{"config":{"models":[{"id":"claude-sonnet-5-5","runtime":{"max_input_tokens":1000000}}]}}}""");
        File.WriteAllText(Path.Combine(dir, "new-cc.json"), """{"fetchedAt":2,"catalog":{"config":{"models":[{"id":"claude-sonnet-5-5","runtime":{"max_input_tokens":400000}}]}}}""");

        var window = ModelSpecs.ContextWindow("claude-sonnet-5-5-20260301", catalogDir: dir);

        Assert.Equal(400_000, window);
    }

    [Fact]
    public async Task The_usage_route_404s_an_unknown_agent()
    {
        using var host = new BridgeHost();

        var response = await host.Client.GetAsync("/agents/nope/usage");

        Assert.Equal(System.Net.HttpStatusCode.NotFound, response.StatusCode);
    }
}
