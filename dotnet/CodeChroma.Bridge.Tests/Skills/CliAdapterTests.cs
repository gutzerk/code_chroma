using CodeChroma.Bridge.Skills;

namespace CodeChroma.Bridge.Tests.Skills;

public class CliAdapterTests
{
    private static readonly Dictionary<string, string> NoKey = new() { ["ANTHROPIC_API_KEY"] = "" };

    [Theory]
    [InlineData("claude", typeof(ClaudeAdapter))]
    [InlineData("codex", typeof(CodexAdapter))]
    [InlineData("kimi-cli", typeof(KimiAdapter))]
    public void The_registry_has_the_expected_adapter(string key, Type type) => Assert.IsType(type, CliAdapters.All[key]);

    [Theory]
    [InlineData("claude")]
    [InlineData("codex")]
    [InlineData("kimi-cli")]
    public void Malformed_json_parses_to_nothing_for_every_adapter(string key) =>
        Assert.Empty(CliAdapters.All[key].ParseLine("not json", "/repo"));

    [Fact]
    public void Claude_argv_matches_the_headless_shape()
    {
        var argv = new ClaudeAdapter().BuildArgv("claude", "do the thing", "claude-haiku-4-5", NoKey);

        Assert.Equal(["claude", "-p", "do the thing", "--model", "claude-haiku-4-5", "--permission-mode", "bypassPermissions", "--output-format", "stream-json", "--verbose"], argv);
    }

    [Fact]
    public void Claude_argv_omits_the_model_flag_when_the_model_is_empty()
    {
        var argv = new ClaudeAdapter().BuildArgv("claude", "p", "", NoKey);

        Assert.DoesNotContain("--model", argv);
    }

    [Theory]
    [InlineData("sk-ant-test", true)]
    [InlineData("", false)]
    public void Claude_argv_adds_bare_only_when_the_run_env_has_an_api_key(string key, bool bare)
    {
        var argv = new ClaudeAdapter().BuildArgv("claude", "p", "m", new Dictionary<string, string> { ["ANTHROPIC_API_KEY"] = key });

        Assert.Equal(bare, argv.Contains("--bare"));
    }

    [Fact]
    public void Claude_argv_omits_bare_for_an_auth_token_alone()
    {
        var argv = new ClaudeAdapter().BuildArgv("claude", "p", "m", new Dictionary<string, string> { ["ANTHROPIC_AUTH_TOKEN"] = "sk-proxy" });

        Assert.DoesNotContain("--bare", argv);
    }

    [Fact]
    public void Claude_renders_a_result_event() =>
        Assert.Equal(["✓ done in 2s"], new ClaudeAdapter().ParseLine("""{"type": "result", "is_error": false, "duration_api_ms": 2000}""", "/repo"));

    [Fact]
    public void Claude_ignores_an_unrecognized_event_type() => Assert.Empty(new ClaudeAdapter().ParseLine("""{"type": "system"}""", "/repo"));

    [Fact]
    public void Codex_argv_runs_unattended()
    {
        var argv = new CodexAdapter().BuildArgv("codex", "do the thing", "gpt-5.6", null);

        Assert.Equal(["codex", "exec", "--model", "gpt-5.6", "--sandbox", "workspace-write", "--json", "do the thing"], argv);
    }

    [Theory]
    [InlineData("""{"type": "item.completed", "item": {"type": "agent_message", "text": "hello"}}""", "hello")]
    [InlineData("""{"type": "item.completed", "item": {"type": "command_execution"}}""", "⏺ command_execution")]
    [InlineData("""{"type": "turn.completed"}""", "✓ done")]
    [InlineData("""{"type": "turn.failed", "message": "boom"}""", "✗ boom")]
    [InlineData("""{"type": "item.completed", "item": {"type": "error", "message": "Model metadata not found."}}""", "  ↳ error: Model metadata not found.")]
    public void Codex_events_render_to_one_line(string raw, string expected) =>
        Assert.Equal([expected], new CodexAdapter().ParseLine(raw, "/repo"));

    [Fact]
    public void Codex_ignores_an_unrecognized_event_type() => Assert.Empty(new CodexAdapter().ParseLine("""{"type": "thread.started"}""", "/repo"));

    [Fact]
    public void Kimi_argv_runs_unattended()
    {
        var argv = new KimiAdapter().BuildArgv("kimi", "do the thing", "kimi-k2", null);

        Assert.Equal(["kimi", "--prompt", "do the thing", "--model", "kimi-k2", "--output-format", "stream-json"], argv);
    }

    [Theory]
    [InlineData("""{"role": "assistant", "content": "hello"}""", "hello")]
    [InlineData("""{"role": "assistant", "content": "", "tool_calls": [{"function": {"name": "grep"}}]}""", "⏺ grep")]
    [InlineData("""{"role": "tool", "is_error": true, "content": "not found"}""", "  ↳ error: not found")]
    public void Kimi_events_render_to_one_line(string raw, string expected) =>
        Assert.Equal([expected], new KimiAdapter().ParseLine(raw, "/repo"));

    [Fact]
    public void Kimi_ignores_a_successful_tool_result() => Assert.Empty(new KimiAdapter().ParseLine("""{"role": "tool", "content": "ok"}""", "/repo"));

    [Fact]
    public void Claude_worker_argv_is_a_zero_tool_single_shot_call()
    {
        var argv = new ClaudeAdapter().BuildWorkerArgv("claude", "p", "m", "{\"type\":\"object\"}");

        Assert.Equal(["claude", "-p", "p", "--model", "m", "--output-format", "json", "--json-schema", "{\"type\":\"object\"}", "--safe-mode", "--strict-mcp-config", "--tools", ""], argv);
    }

    [Theory]
    [InlineData("""{"structured_output": {"a": 1}}""", """{"a":1}""")]
    [InlineData("""{"result": "{\"b\": 2}"}""", """{"b":2}""")]
    [InlineData("""{"is_error": true, "result": "x"}""", null)]
    [InlineData("""{"result": "not json"}""", null)]
    [InlineData("nope", null)]
    public void Claude_worker_envelopes_unwrap_to_an_object(string raw, string? expected) =>
        Assert.Equal(expected, new ClaudeAdapter().ParseStructuredOutput(raw)?.ToJsonString());
}
