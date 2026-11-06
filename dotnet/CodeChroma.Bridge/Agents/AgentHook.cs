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

    /// <summary>The SessionStart source (also its hook matcher) of a `/clear`, which clears the agent window's history.</summary>
    public const string ClearSource = "clear";

    /// <summary>Whether a report is the SessionStart that `/clear` or one of its aliases fires.</summary>
    public static bool IsClear(JsonObject report) => Json.Str(report["hook_event_name"]) == "SessionStart" && Json.Str(report["source"]) == ClearSource;

    /// <summary>Whether a report is the UserPromptSubmit that can carry hidden prompt context.</summary>
    public static bool IsPromptSubmit(JsonObject report) => Json.Str(report["hook_event_name"]) == "UserPromptSubmit";

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

    /// <summary>Claude's answer to a UserPromptSubmit the bridge has pending context for: hidden context added to that prompt.</summary>
    public static string PromptContextOutput(string context) => new JsonObject
    {
        ["hookSpecificOutput"] = new JsonObject
        {
            ["hookEventName"] = "UserPromptSubmit",
            ["additionalContext"] = context,
        },
    }.ToJsonString();

    /// <summary>Posts stdin to the bridge; prints a decision for an answered PermissionRequest or pending context for a UserPromptSubmit; every error exits 0 silently.</summary>
    public static int Run(TextReader input, TextWriter output, Func<string, string, string, int, string?>? post = null)
    {
        if (HookEnv.Wired() is not { } wiring) return 0;
        try
        {
            var report = Slim(JsonNode.Parse(input.ReadToEnd()) as JsonObject ?? new JsonObject());
            var permission = Json.Str(report["hook_event_name"]) == "PermissionRequest";
            var url = $"{wiring.BaseUrl}/agents/{Uri.EscapeDataString(wiring.WorkspaceId)}/hook";
            var reply = (post ?? Post)(url, wiring.Token, report.ToJsonString(), permission ? PermissionWaitMs + PostTimeoutMs : PostTimeoutMs);
            if (reply is null) return 0;
            var answer = JsonNode.Parse(reply);
            var decision = permission ? Json.Str(answer?["decision"]) : null;
            if (decision is "allow" or "deny") output.Write(DecisionOutput(decision));
            if (IsPromptSubmit(report) && Json.Str(answer?["additional_context"]) is { Length: > 0 } context) output.Write(PromptContextOutput(context));
        }
        catch (Exception) { }
        return 0;
    }

    /// <summary>Only what the bridge reads off a report (never tool_response, which can be a whole file): the event, the tool, its target keys, the notification type and the SessionStart source.</summary>
    public static JsonObject Slim(JsonObject report)
    {
        var slim = new JsonObject();
        foreach (var key in new[] { "hook_event_name", "tool_name", "notification_type", "source" })
            if (report.TryGetPropertyValue(key, out var value)) slim[key] = value?.DeepClone();
        if (report["tool_input"] is JsonObject input)
        {
            var kept = new JsonObject();
            foreach (var key in AgentStatusState.TargetKeys)
                if (input.TryGetPropertyValue(key, out var value)) kept[key] = value?.DeepClone();
            slim["tool_input"] = kept;
        }
        return slim;
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
}
