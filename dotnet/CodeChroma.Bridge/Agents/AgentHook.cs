using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Agents;

/// <summary>The `agent-hook` subcommand: forwards one Claude Code hook report to POST /agents/{id}/hook; never fails the agent.</summary>
public static class AgentHook
{
    public const string Command = "agent-hook";

    /// <summary>The events that drive the status LED; PreToolUse, PostToolUse and PermissionRequest match every tool.</summary>
    public static readonly string[] Events = ["UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "Notification", "PermissionRequest"];

    /// <summary>How long the bridge holds a PermissionRequest for a canvas decision; short, because the terminal dialog only shows once the hook returns.</summary>
    public const int PermissionWaitMs = 1000;

    /// <summary>The HTTP timeout of an ordinary report: a slow bridge must never stall the agent.</summary>
    public const int PostTimeoutMs = 2000;

    /// <summary>Claude's own timeout for the hook command, in seconds.</summary>
    public const int HookTimeoutSeconds = 10;

    /// <summary>Claude's answer to a PermissionRequest the canvas decided.</summary>
    public static string DecisionOutput(string behavior) => new JsonObject
    {
        ["hookSpecificOutput"] = new JsonObject
        {
            ["hookEventName"] = "PermissionRequest",
            ["decision"] = new JsonObject { ["behavior"] = behavior },
        },
    }.ToJsonString();

    /// <summary>Posts stdin to the bridge; prints a decision only for an answered PermissionRequest; every error exits 0 silently.</summary>
    public static int Run(TextReader input, TextWriter output, Func<string, string, string, int, string?>? post = null)
    {
        var baseUrl = Env(BridgeAddress.BridgeUrlEnv).TrimEnd('/');
        var token = Env(McpEndpoint.TokenEnv);
        var agentId = Env(BridgeAddress.WorkspaceIdEnv);
        if (baseUrl.Length == 0 || token.Length == 0 || agentId.Length == 0) return 0;
        try
        {
            var text = input.ReadToEnd();
            var permission = Json.Str((JsonNode.Parse(text) as JsonObject)?["hook_event_name"]) == "PermissionRequest";
            var url = $"{baseUrl}/agents/{Uri.EscapeDataString(agentId)}/hook";
            var reply = (post ?? Post)(url, token, text, permission ? PermissionWaitMs + PostTimeoutMs : PostTimeoutMs);
            var decision = permission && reply is not null ? Json.Str(JsonNode.Parse(reply)?["decision"]) : null;
            if (decision is "allow" or "deny") output.Write(DecisionOutput(decision));
        }
        catch (Exception) { }
        return 0;
    }

    /// <summary>The reply body of a 2xx POST, or null on any other outcome.</summary>
    private static string? Post(string url, string token, string body, int timeoutMs)
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromMilliseconds(timeoutMs) };
            using var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            using var response = http.Send(request);
            if (!response.IsSuccessStatusCode) return null;
            using var reader = new StreamReader(response.Content.ReadAsStream());
            return reader.ReadToEnd();
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>The CODECHROMA_* variable, falling back to the lower-cased spelling older builds used.</summary>
    private static string Env(string name) =>
        Environment.GetEnvironmentVariable(name) is { Length: > 0 } value ? value
        : Environment.GetEnvironmentVariable(string.Concat("codechroma_", name.AsSpan("CODECHROMA_".Length))) ?? "";
}
