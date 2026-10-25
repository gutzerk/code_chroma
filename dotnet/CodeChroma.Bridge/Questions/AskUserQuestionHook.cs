using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Questions;

/// <summary>The PreToolUse hook that denies native AskUserQuestion in favour of ask_user; fails open when unsure.</summary>
public static class AskUserQuestionHook
{
    public const string Command = "ask-user-question";
    public const string ToolMatcher = "AskUserQuestion";
    public const int ProbeMilliseconds = 500;
    public const string DenyReason =
        "Do not use AskUserQuestion. Ask through the mcp__codechroma__ask_user tool: question, and "
        + "2-4 options that each have id, title, description, pro, con and why; exactly one option "
        + "has rank 1 (your recommendation). Use kind \"diagram\" with draw_option_diagram for "
        + "structural questions.";

    /// <summary>The hook output that refuses the native tool and names the one to use instead.</summary>
    public static string DenyDecision() => new JsonObject
    {
        ["hookSpecificOutput"] = new JsonObject
        {
            ["hookEventName"] = "PreToolUse",
            ["permissionDecision"] = "deny",
            ["permissionDecisionReason"] = DenyReason,
        },
    }.ToJsonString();

    /// <summary>Denies only when the launcher wired the codechroma MCP server (token env) and /mcp is up; any error exits 0 silently.</summary>
    public static int Run(TextReader input, TextWriter output, Func<string, bool>? bridgeAnswers = null)
    {
        var baseUrl = Env(BridgeAddress.BridgeUrlEnv).TrimEnd('/');
        if (baseUrl.Length == 0 || Env(McpEndpoint.TokenEnv).Length == 0 || Env(BridgeAddress.WorkspaceIdEnv).Length == 0) return 0;
        try
        {
            var payload = JsonNode.Parse(input.ReadToEnd());
            if (payload?["tool_input"]?["questions"] is { } questions && Json.Truthy(questions) && (bridgeAnswers ?? ProbeBridge)(baseUrl))
                output.Write(DenyDecision());
        }
        catch (Exception) { }
        return 0;
    }

    /// <summary>Whether the bridge's /mcp endpoint answers; a 404 or a server error means it is not our bridge.</summary>
    private static bool ProbeBridge(string baseUrl)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromMilliseconds(ProbeMilliseconds) };
            using var response = http.GetAsync($"{baseUrl}/mcp/").GetAwaiter().GetResult();
            return (int)response.StatusCode is < 500 and not 404;
        }
        catch (Exception)
        {
            return false;
        }
    }

    /// <summary>The CODECHROMA_* variable, falling back to the lower-cased spelling older builds used.</summary>
    private static string Env(string name) =>
        Environment.GetEnvironmentVariable(name) is { Length: > 0 } value ? value
        : Environment.GetEnvironmentVariable(string.Concat("codechroma_", name.AsSpan("CODECHROMA_".Length))) ?? "";
}
