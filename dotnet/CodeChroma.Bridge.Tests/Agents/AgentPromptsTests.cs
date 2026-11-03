using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Tests.Support;

namespace CodeChroma.Bridge.Tests.Agents;

/// <summary>The prompt navigator's list: user prompts and per-reply edit/run counts read from a claude transcript.</summary>
public sealed class AgentPromptsTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "cc-prompts-" + Guid.NewGuid().ToString("N")[..8]);

    public void Dispose()
    {
        if (Directory.Exists(_root)) Directory.Delete(_root, true);
    }

    private static string User(string uuid, JsonNode content, bool meta = false, bool sidechain = false) =>
        new JsonObject
        {
            ["type"] = "user", ["uuid"] = uuid, ["timestamp"] = "2026-11-03T14:02:00Z", ["isMeta"] = meta, ["isSidechain"] = sidechain,
            ["cwd"] = "C:/work/tree", ["sessionId"] = "s1", ["message"] = new JsonObject { ["role"] = "user", ["content"] = content },
        }.ToJsonString();

    private static string Tools(params (string Id, string Name)[] calls) =>
        new JsonObject
        {
            ["type"] = "assistant", ["sessionId"] = "s1",
            ["message"] = new JsonObject
            {
                ["content"] = new JsonArray(calls.Select(c => (JsonNode?)new JsonObject { ["type"] = "tool_use", ["id"] = c.Id, ["name"] = c.Name }).ToArray()),
            },
        }.ToJsonString();

    private static JsonArray ToolResult() => [new JsonObject { ["type"] = "tool_result", ["tool_use_id"] = "t1", ["content"] = "ok" }];

    private AgentRecord Agent(string kind, params string[] lines)
    {
        Directory.CreateDirectory(Path.Combine(_root, "C--work-tree"));
        File.WriteAllLines(Path.Combine(_root, "C--work-tree", "s1.jsonl"), lines);
        return new AgentRecord { Id = "a1", Title = "A", Kind = kind, Branch = "b", Worktree = "C:/work/tree", CreatedAt = "2026-10-22T00:00:00Z" };
    }

    [Fact]
    public void Prompts_keep_only_what_the_user_typed_with_the_reply_counts()
    {
        var record = Agent("claude",
            User("u1", "Fix the token refresh race"),
            Tools(("t1", "Read"), ("t2", "Edit")),
            Tools(("t2", "Edit")),
            User("r1", ToolResult()),
            Tools(("t3", "Bash"), ("t4", "Write")),
            User("m1", "Caveat: meta", meta: true),
            User("s1", "subagent prompt", sidechain: true),
            User("i1", "[Request interrupted by user]"),
            User("u2", new JsonArray(new JsonObject { ["type"] = "text", ["text"] = "Why a lock?" })));

        var prompts = AgentPrompts.ReadSession("s1", record.Worktree, _root);

        Assert.Equal(["Fix the token refresh race", "Why a lock?"], prompts.Select(p => p.Text));
        Assert.Equal((2, 1), (prompts[0].Edits, prompts[0].Runs));
        Assert.Equal((0, 0), (prompts[1].Edits, prompts[1].Runs));
        Assert.Equal("u1", prompts[0].Id);
        Assert.Equal("2026-11-03T14:02:00Z", prompts[0].CreatedAt);
    }

    [Theory]
    [InlineData("<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>PR 12</command-args>", "/review PR 12")]
    [InlineData("<command-name>/clear</command-name><command-args></command-args>", "/clear")]
    [InlineData("<bash-input>git status</bash-input>", "!git status")]
    [InlineData("<local-command-stdout>done</local-command-stdout>", null)]
    [InlineData("<bash-stdout>x</bash-stdout><bash-stderr></bash-stderr>", null)]
    [InlineData("<Button> is misaligned on mobile", "<Button> is misaligned on mobile")]
    public void Command_entries_read_as_what_was_typed_and_their_output_is_skipped(string content, string? expected)
    {
        var text = AgentPrompts.PromptText(JsonValue.Create(content));

        Assert.Equal(expected, text);
    }

    [Theory]
    [InlineData("claude", null)]
    [InlineData("codex", "s1")]
    public void No_session_or_a_non_claude_agent_has_an_empty_list(string kind, string? session)
    {
        var record = Agent(kind, User("u1", "hi"));

        var payload = AgentPrompts.Read(record, () => session, _root);

        Assert.Empty(payload["prompts"]!.AsArray());
    }

    [Fact]
    public void The_payload_names_each_prompt_field_in_camel_case()
    {
        var record = Agent("claude", User("u1", "hi"), Tools(("t1", "Bash")));

        var prompt = AgentPrompts.Read(record, () => "s1", _root)["prompts"]![0]!.AsObject();

        Assert.Equal(["id", "text", "createdAt", "edits", "runs"], prompt.Select(p => p.Key));
        Assert.Equal(1, prompt["runs"]!.GetValue<int>());
    }

    [Fact]
    public void A_non_claude_agent_never_captures_a_session()
    {
        var record = Agent("codex", User("u1", "hi"));
        var captured = false;

        AgentPrompts.Read(record, () => { captured = true; return "s1"; }, _root);

        Assert.False(captured);
    }

    [Fact]
    public void A_grown_transcript_is_read_again()
    {
        var record = Agent("claude", User("u1", "first"));
        AgentPrompts.ReadSession("s1", record.Worktree, _root);
        File.AppendAllLines(Path.Combine(_root, "C--work-tree", "s1.jsonl"), [User("u2", "second")]);

        var prompts = AgentPrompts.ReadSession("s1", record.Worktree, _root);

        Assert.Equal(["first", "second"], prompts.Select(p => p.Text));
    }

    [Fact]
    public async Task The_prompts_route_404s_an_unknown_agent()
    {
        using var host = new BridgeHost();

        var response = await host.Client.GetAsync("/agents/nope/prompts");

        Assert.Equal(System.Net.HttpStatusCode.NotFound, response.StatusCode);
    }
}
