using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Tests.Support;

namespace CodeChroma.Bridge.Tests.Agents;

/// <summary>The agents full-screen usage strip: transcript totals, cache hit, cost per model and the usage route.</summary>
public sealed class AgentUsageTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "cc-usage-" + Guid.NewGuid().ToString("N")[..8]);

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
    public void Usage_sums_every_reply_once_and_prices_it_per_model()
    {
        var record = Agent("claude",
            """{"type":"user","cwd":"C:/work/tree","sessionId":"s1","message":{"content":"hi"}}""",
            Reply("m1", "claude-opus-5-5", 100_000, 0, 20_000, 4_000),
            Reply("m1", "claude-opus-5-5", 100_000, 0, 20_000, 4_000),
            Reply("m2", "claude-opus-5-5", 2_000, 110_000, 8_000, 6_000),
            Reply("m3", "claude-haiku-5-5", 1_000, 9_000, 0, 500, sidechain: true),
            Reply("m4", "<synthetic>", 0, 0, 0, 0));

        var usage = AgentUsage.Read(record, "s1", _root)!;

        Assert.Equal(120_000, usage["contextTokens"]!.GetValue<long>());
        Assert.Equal(ModelSpecs.DefaultContextWindow, usage["contextWindow"]!.GetValue<long>());
        Assert.Equal(250_000, usage["inputTokens"]!.GetValue<long>());
        Assert.Equal(10_500, usage["outputTokens"]!.GetValue<long>());
        Assert.Equal(119_000, usage["cacheReadTokens"]!.GetValue<long>());
        Assert.Equal(0.476, usage["cacheHitRatio"]!.GetValue<double>());
        Assert.Equal(0.7704m, usage["costUsd"]!.GetValue<decimal>());
    }

    [Fact]
    public void A_reply_streamed_as_several_entries_counts_its_final_output()
    {
        var record = Agent("claude",
            Reply("m1", "claude-opus-5-5", 10, 1_000, 0, 5),
            Reply("m1", "claude-opus-5-5", 10, 1_000, 0, 900));

        var usage = AgentUsage.Read(record, "s1", _root)!;

        Assert.Equal(900, usage["outputTokens"]!.GetValue<long>());
    }

    [Fact]
    public void A_context_past_the_default_window_reports_the_long_window()
    {
        var record = Agent("claude", Reply("m1", "claude-opus-5-5", 10, 300_000, 0, 50));

        var usage = AgentUsage.Read(record, "s1", _root)!;

        Assert.Equal(ModelSpecs.LongContextWindow, usage["contextWindow"]!.GetValue<long>());
    }

    [Fact]
    public void An_unknown_model_leaves_the_cost_null_but_keeps_the_tokens()
    {
        var record = Agent("claude", Reply("m1", "claude-unknown-9", 1_000, 3_000, 0, 50));

        var usage = AgentUsage.Read(record, "s1", _root)!;

        Assert.Null(usage["costUsd"]);
        Assert.Equal(4_000, usage["inputTokens"]!.GetValue<long>());
        Assert.Equal(0.75, usage["cacheHitRatio"]!.GetValue<double>());
    }

    [Theory]
    [InlineData("claude", null)]
    [InlineData("codex", "s1")]
    public void No_session_or_a_non_claude_agent_has_no_usage(string kind, string? session)
    {
        var record = Agent(kind, Reply("m1", "claude-opus-5-5", 1, 1, 1, 1));

        var usage = AgentUsage.Read(record, session, _root);

        Assert.Null(usage);
    }

    [Theory]
    [InlineData("claude-opus-5-5", 4.0)]
    [InlineData("claude-opus-5-5[1m]", 4.0)]
    [InlineData("claude-opus-5-20260301", 5.0)]
    [InlineData("claude-sonnet-5-5", 2.0)]
    public void A_model_id_or_its_dated_snapshot_finds_its_input_price(string model, double input)
    {
        var price = ModelSpecs.Price(model);

        Assert.Equal((decimal)input, price!.Input);
    }

    [Fact]
    public async Task The_usage_route_404s_an_unknown_agent()
    {
        using var host = new BridgeHost();

        var response = await host.Client.GetAsync("/agents/nope/usage");

        Assert.Equal(System.Net.HttpStatusCode.NotFound, response.StatusCode);
    }
}
