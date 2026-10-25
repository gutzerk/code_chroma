using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Questions;

namespace CodeChroma.Bridge.Tests.Questions;

[Collection("HookEnv")]
public sealed class AskUserQuestionHookTests : IDisposable
{
    private static readonly string[] Vars = [BridgeAddress.BridgeUrlEnv, McpEndpoint.TokenEnv, BridgeAddress.WorkspaceIdEnv];
    private const string WithQuestions = """{"tool_input":{"questions":[{"question":"q"}]}}""";

    public AskUserQuestionHookTests() => SetWired();

    public void Dispose()
    {
        foreach (var name in Vars) Environment.SetEnvironmentVariable(name, null);
    }

    private static void SetWired()
    {
        Environment.SetEnvironmentVariable(BridgeAddress.BridgeUrlEnv, "http://127.0.0.1:1");
        Environment.SetEnvironmentVariable(McpEndpoint.TokenEnv, "t");
        Environment.SetEnvironmentVariable(BridgeAddress.WorkspaceIdEnv, "main");
    }

    private static (int Code, string Output) Run(string stdin, bool answers)
    {
        var output = new StringWriter();
        var code = AskUserQuestionHook.Run(new StringReader(stdin), output, _ => answers);
        return (code, output.ToString());
    }

    [Fact]
    public void Without_the_wired_env_it_stays_silent()
    {
        Environment.SetEnvironmentVariable(McpEndpoint.TokenEnv, null);

        var (code, output) = Run(WithQuestions, answers: true);

        Assert.Equal((0, ""), (code, output));
    }

    [Fact]
    public void Without_questions_it_stays_silent()
    {
        var (_, output) = Run("""{"tool_input":{}}""", answers: true);

        Assert.Equal("", output);
    }

    [Fact]
    public void An_unreachable_bridge_stays_silent()
    {
        var (_, output) = Run(WithQuestions, answers: false);

        Assert.Equal("", output);
    }

    [Fact]
    public void Invalid_stdin_exits_zero_silently()
    {
        var (code, output) = Run("not json", answers: true);

        Assert.Equal((0, ""), (code, output));
    }

    [Fact]
    public void A_reachable_bridge_gets_a_deny_decision()
    {
        var (_, output) = Run(WithQuestions, answers: true);

        var decision = JsonNode.Parse(output)!["hookSpecificOutput"]!;
        Assert.Equal("deny", (string?)decision["permissionDecision"]);
        Assert.Equal(AskUserQuestionHook.DenyReason, (string?)decision["permissionDecisionReason"]);
    }

    [Fact]
    public void Hook_settings_register_both_events_when_asked()
    {
        var hooks = JsonNode.Parse(AgentSessionOwnership.HookSettings(askUserQuestion: true))!["hooks"]!;

        Assert.Equal("AskUserQuestion", (string?)hooks["PreToolUse"]![0]!["matcher"]);
        Assert.EndsWith(" ask-user-question", (string?)hooks["PreToolUse"]![0]!["hooks"]![0]!["command"]);
        Assert.NotNull(hooks["SessionStart"]);
    }

    [Fact]
    public void Hook_settings_omit_the_question_hook_by_default()
    {
        var hooks = JsonNode.Parse(AgentSessionOwnership.HookSettings())!["hooks"]!;

        Assert.Null(hooks["PreToolUse"]);
    }
}
