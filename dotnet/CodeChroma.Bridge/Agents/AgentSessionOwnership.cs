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

    public static string HookSettings()
    {
        // Use the native apphost when published and dotnet + our assembly during development/tests.
        var assembly = typeof(AgentSessionOwnership).Assembly.Location;
        var apphost = Path.Combine(Path.GetDirectoryName(assembly)!, "CodeChroma.Bridge" + (OperatingSystem.IsWindows() ? ".exe" : ""));
        var published = Path.Combine(AppContext.BaseDirectory, "codechroma-bridge" + (OperatingSystem.IsWindows() ? ".exe" : ""));
        var command = File.Exists(published) ? Quote(published) : File.Exists(apphost) ? Quote(apphost) : "dotnet " + Quote(assembly);
        return new JsonObject
        {
            ["hooks"] = new JsonObject
            {
                ["SessionStart"] = new JsonArray(new JsonObject
                {
                    ["hooks"] = new JsonArray(new JsonObject { ["type"] = "command", ["command"] = command + " agent-session", ["timeout"] = 5 }),
                }),
            },
        }.ToJsonString();
    }

    private static string Quote(string path) => "'" + path.Replace('\\', '/').Replace("'", "'\"'\"'") + "'";

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
