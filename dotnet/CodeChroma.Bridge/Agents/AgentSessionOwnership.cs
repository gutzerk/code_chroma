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

    public static string HookSettings(bool sessionTracking = true, bool askUserQuestion = false)
    {
        // Use the native apphost when published and dotnet + our assembly during development/tests.
        var assembly = typeof(AgentSessionOwnership).Assembly.Location;
        var apphost = Path.Combine(Path.GetDirectoryName(assembly)!, "CodeChroma.Bridge" + (OperatingSystem.IsWindows() ? ".exe" : ""));
        var published = Path.Combine(AppContext.BaseDirectory, "codechroma-bridge" + (OperatingSystem.IsWindows() ? ".exe" : ""));
        var executable = File.Exists(published) ? published : File.Exists(apphost) ? apphost : null;
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
        return new JsonObject { ["hooks"] = hooks }.ToJsonString();
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
