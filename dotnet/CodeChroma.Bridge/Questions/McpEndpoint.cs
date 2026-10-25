using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Questions;

/// <summary>Where one workspace's agent reaches the bridge: its base URL and bearer token (questions/launch.py).</summary>
public sealed record McpEndpoint(string WorkspaceId, string BaseUrl, string Token, TimeSpan AskWait)
{
    public const string UrlEnv = "CODECHROMA_BRIDGE_URL";
    public const string TokenEnv = "CODECHROMA_QUESTION_TOKEN";

    public string McpUrl => BaseUrl + "/mcp/";

    /// <summary>Env for the agent process, read by the AskUserQuestion hook (the workspace id comes from BridgeAddress.ExportIdentity).</summary>
    public IReadOnlyDictionary<string, string> Env() => new Dictionary<string, string> { [UrlEnv] = BaseUrl, [TokenEnv] = Token };

    /// <summary>The --mcp-config document: one http server with a bearer header and a timeout past the ask wait.</summary>
    public JsonObject ClaudeConfig() => new()
    {
        ["mcpServers"] = new JsonObject
        {
            [QuestionMcp.ServerName] = new JsonObject
            {
                ["type"] = "http", ["url"] = McpUrl,
                ["headers"] = new JsonObject { ["Authorization"] = "Bearer " + Token },
                ["timeout"] = (int)(AskWait.TotalSeconds + 60) * 1000,
            },
        },
    };

    /// <summary>Writes the config to a private temp file (inline JSON gets mangled by PTY quoting) and returns its path.</summary>
    public string WriteClaudeConfig()
    {
        var directory = Path.Combine(Path.GetTempPath(), "codechroma-mcp");
        Directory.CreateDirectory(directory);
        var safe = new string(WorkspaceId.Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' ? c : '_').ToArray());
        var path = Path.Combine(directory, safe + ".json");
        File.WriteAllText(path, ClaudeConfig().ToJsonString());
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        return path;
    }
}
