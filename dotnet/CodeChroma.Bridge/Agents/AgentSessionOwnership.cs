using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Agents;

/// <summary>A per-launch file receives only this Claude process's SessionStart events, including /clear and /resume.</summary>
public static class AgentSessionOwnership
{
    public const string FileEnv = "CODECHROMA_AGENT_SESSION_FILE";
    public const string InitialIdEnv = "CODECHROMA_AGENT_SESSION_ID";

    public static string FileFor(string root, string trackingId)
    {
        if (!Guid.TryParse(trackingId, out var id)) throw new ArgumentException("invalid session tracking id", nameof(trackingId));
        return Path.Combine(root, ".codechroma", "agent-sessions", id.ToString() + ".json");
    }

    public static string HookSettings(bool sessionTracking = true, bool askUserQuestion = false, bool statusHooks = false) =>
        TryHookSettings(sessionTracking, askUserQuestion, statusHooks) ?? new JsonObject { ["hooks"] = new JsonObject() }.ToJsonString();

    /// <summary>The `--settings` document: the hooks plus, with `askUserQuestion` (the MCP server is registered), its tools pre-approved; null when it would hold nothing.</summary>
    public static string? TryHookSettings(bool sessionTracking = true, bool askUserQuestion = false, bool statusHooks = false)
    {
        var hooks = Hooks(sessionTracking, askUserQuestion, statusHooks);
        if (hooks is null && !askUserQuestion) return null;
        var settings = new JsonObject();
        if (hooks is not null) settings["hooks"] = hooks;
        if (askUserQuestion)
            settings["permissions"] = new JsonObject { ["allow"] = new JsonArray(Questions.McpEndpoint.ClaudePermission) };
        return settings.ToJsonString();
    }

    /// <summary>The hook commands, or null when no bridge executable can be resolved to run them.</summary>
    private static JsonObject? Hooks(bool sessionTracking, bool askUserQuestion, bool statusHooks)
    {
        // Use the native apphost when published and dotnet + our assembly during development/tests.
        var assembly = typeof(AgentSessionOwnership).Assembly.Location;
        var apphost = Path.Combine(Path.GetDirectoryName(assembly)!, "CodeChroma.Bridge" + (OperatingSystem.IsWindows() ? ".exe" : ""));
        var published = Path.Combine(AppContext.BaseDirectory, "codechroma-bridge" + (OperatingSystem.IsWindows() ? ".exe" : ""));
        var executable = File.Exists(published) ? published : File.Exists(apphost) ? apphost : null;
        if (executable is null && string.IsNullOrEmpty(assembly)) return null;
        var command = executable is not null
            ? (OperatingSystem.IsWindows() ? "& " : "") + Quote(executable)
            : "dotnet " + Quote(assembly);
        JsonObject Hook(string subcommand, int timeout)
        {
            var hook = new JsonObject { ["type"] = "command", ["command"] = command + " " + subcommand, ["timeout"] = timeout };
            if (OperatingSystem.IsWindows()) hook["shell"] = "powershell";
            return hook;
        }
        var hooks = new JsonObject();
        if (sessionTracking)
            hooks["SessionStart"] = new JsonArray(new JsonObject { ["hooks"] = new JsonArray(Hook("agent-session", 5)) });
        if (askUserQuestion)
            hooks["PreToolUse"] = new JsonArray(new JsonObject
            {
                ["matcher"] = Questions.AskUserQuestionHook.ToolMatcher,
                ["hooks"] = new JsonArray(Hook(Questions.AskUserQuestionHook.Command, 15)),
            });
        if (statusHooks)
            foreach (var name in AgentHook.Events)
            {
                var entry = new JsonObject();
                if (name is "PreToolUse" or "PostToolUse" or "PermissionRequest") entry["matcher"] = "*";
                entry["hooks"] = new JsonArray(Hook(AgentHook.Command, AgentHook.HookTimeoutSeconds));
                if (hooks[name] is not JsonArray list) hooks[name] = list = [];
                list.Add(entry);
            }
        if (statusHooks)
        {
            // only a /clear reports, so startup, resume and compact start no extra process
            if (hooks["SessionStart"] is not JsonArray starts) hooks["SessionStart"] = starts = [];
            starts.Add(new JsonObject { ["matcher"] = AgentHook.ClearSource, ["hooks"] = new JsonArray(Hook(AgentHook.Command, AgentHook.HookTimeoutSeconds)) });
        }
        return hooks;
    }

    private static string Quote(string path) => "'" + path.Replace('\\', '/').Replace("'", OperatingSystem.IsWindows() ? "''" : "'\"'\"'") + "'";

    /// <summary>Runs as a hook helper without booting the bridge or requiring Python or a listening HTTP server.</summary>
    public static int Record(TextReader input, string? file)
    {
        if (string.IsNullOrEmpty(file)) return 0;
        try
        {
            var payload = JsonNode.Parse(input.ReadToEnd());
            if (Json.Str(payload?["session_id"]) is { } session && Guid.TryParse(session, out _))
                JsonFile.Write(file, new JsonObject { ["session_id"] = session });
        }
        catch (Exception error) when (error is System.Text.Json.JsonException or IOException or UnauthorizedAccessException or InvalidOperationException) { }
        return 0;
    }
}
