using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Questions;

namespace CodeChroma.Bridge.Tests.Agents;

/// <summary>The `agent-hook` subcommand and its registration in the Claude `--settings` document.</summary>
[Collection("HookEnv")]
public sealed class AgentHookTests : IDisposable
{
    private static readonly string[] Vars = [BridgeAddress.BridgeUrlEnv, McpEndpoint.TokenEnv, BridgeAddress.WorkspaceIdEnv];

    private readonly List<(string Url, string Token, string Body, int TimeoutMs)> _posts = [];

    public AgentHookTests()
    {
        Environment.SetEnvironmentVariable(BridgeAddress.BridgeUrlEnv, "http://127.0.0.1:9/");
        Environment.SetEnvironmentVariable(McpEndpoint.TokenEnv, "agent1.sig");
        Environment.SetEnvironmentVariable(BridgeAddress.WorkspaceIdEnv, "agent1");
    }

    public void Dispose()
    {
        foreach (var name in Vars) Environment.SetEnvironmentVariable(name, null);
    }

    private (int Code, string Output) Run(string stdin, string? reply)
    {
        var output = new StringWriter();
        var code = AgentHook.Run(new StringReader(stdin), output, (url, token, body, timeout) =>
        {
            _posts.Add((url, token, body, timeout));
            return reply;
        });
        return (code, output.ToString());
    }

    [Fact]
    public void A_report_is_posted_to_the_agents_hook_route_with_its_token()
    {
        const string stdin = """{"hook_event_name":"Stop"}""";

        var (code, output) = Run(stdin, """{"ok":true}""");

        Assert.Equal((0, ""), (code, output));
        Assert.Equal(("http://127.0.0.1:9/agents/agent1/hook", "agent1.sig", stdin, AgentHook.PostTimeoutMs), _posts.Single());
    }

    [Fact]
    public void Only_the_fields_the_bridge_reads_are_posted_never_the_tool_response()
    {
        const string stdin = """{"hook_event_name":"PostToolUse","session_id":"s","tool_name":"Read","tool_input":{"file_path":"a.cs","limit":5},"tool_response":{"content":"whole file"}}""";

        Run(stdin, """{"ok":true}""");

        Assert.Equal("""{"hook_event_name":"PostToolUse","tool_name":"Read","tool_input":{"file_path":"a.cs"}}""", _posts.Single().Body);
    }

    [Fact]
    public void Without_the_token_env_nothing_is_posted()
    {
        Environment.SetEnvironmentVariable(McpEndpoint.TokenEnv, null);

        var (code, _) = Run("""{"hook_event_name":"Stop"}""", null);

        Assert.Equal(0, code);
        Assert.Empty(_posts);
    }

    [Theory]
    [InlineData("allow")]
    [InlineData("deny")]
    public void A_decided_permission_request_prints_claudes_decision(string decision)
    {
        var (_, output) = Run("""{"hook_event_name":"PermissionRequest","tool_name":"Bash"}""", $$"""{"decision":"{{decision}}"}""");

        var printed = JsonNode.Parse(output)!["hookSpecificOutput"]!;
        Assert.Equal("PermissionRequest", (string?)printed["hookEventName"]);
        Assert.Equal(decision, (string?)printed["decision"]!["behavior"]);
        Assert.Equal(AgentHook.PermissionWaitMs + AgentHook.PostTimeoutMs, _posts.Single().TimeoutMs);
    }

    [Theory]
    [InlineData("""{"decision":null}""")]
    [InlineData(null)]
    [InlineData("not json")]
    public void An_undecided_or_failed_permission_request_prints_nothing(string? reply)
    {
        var (code, output) = Run("""{"hook_event_name":"PermissionRequest"}""", reply);

        Assert.Equal((0, ""), (code, output));
    }

    [Fact]
    public void A_prompt_submit_with_pending_context_prints_it_as_hidden_additional_context()
    {
        var (code, output) = Run("""{"hook_event_name":"UserPromptSubmit","prompt":"go"}""", """{"ok":true,"additional_context":"looking at C1"}""");

        var printed = JsonNode.Parse(output)!["hookSpecificOutput"]!;
        Assert.Equal(0, code);
        Assert.Equal(("UserPromptSubmit", "looking at C1"), ((string?)printed["hookEventName"], (string?)printed["additionalContext"]));
    }

    [Theory]
    [InlineData("""{"ok":true}""")]
    [InlineData(null)]
    [InlineData("not json")]
    public void A_prompt_submit_without_context_prints_nothing(string? reply)
    {
        var (code, output) = Run("""{"hook_event_name":"UserPromptSubmit"}""", reply);

        Assert.Equal((0, ""), (code, output));
    }

    [Fact]
    public void An_unreachable_bridge_exits_zero_silently()
    {
        var output = new StringWriter();

        var code = AgentHook.Run(new StringReader("""{"hook_event_name":"PreToolUse"}"""), output);

        Assert.Equal((0, ""), (code, output.ToString()));
    }

    [Fact]
    public void Status_hooks_register_every_event_and_keep_the_question_matcher_first()
    {
        var hooks = JsonNode.Parse(AgentSessionOwnership.HookSettings(askUserQuestion: true, statusHooks: true))!["hooks"]!;

        Assert.All(AgentHook.Events, name => Assert.EndsWith(" agent-hook", (string?)hooks[name]!.AsArray().Last()!["hooks"]![0]!["command"]));
        Assert.Equal(["AskUserQuestion", "*"], hooks["PreToolUse"]!.AsArray().Select(e => (string?)e!["matcher"]));
        Assert.Null(hooks["Stop"]![0]!["matcher"]);
        Assert.Equal("*", (string?)hooks["PermissionRequest"]![0]!["matcher"]);
    }

    [Fact]
    public void Without_status_hooks_no_agent_hook_is_registered()
    {
        var settings = AgentSessionOwnership.HookSettings(askUserQuestion: true);

        Assert.DoesNotContain(AgentHook.Command, settings);
    }
}
