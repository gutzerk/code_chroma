using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;

namespace CodeChroma.Bridge.Questions;

/// <summary>Where one workspace's agent reaches the bridge: its base URL and its bearer token.</summary>
public sealed record McpEndpoint(string WorkspaceId, string BaseUrl, string Token)
{
    public const string TokenEnv = "CODECHROMA_QUESTION_TOKEN";
    public const string ServerName = "codechroma";

    public string McpUrl => BaseUrl.TrimEnd('/') + "/mcp/";

    /// <summary>Env for the agent process (read by skills and the AskUserQuestion hook).</summary>
    public Dictionary<string, string> Env() => new()
    {
        [BridgeAddress.BridgeUrlEnv] = BaseUrl.TrimEnd('/'),
        [TokenEnv] = Token,
        [BridgeAddress.WorkspaceIdEnv] = WorkspaceId,
    };

    /// <summary>The `--mcp-config` document: one http server with a bearer header and a long timeout.</summary>
    public JsonObject ClaudeConfig(TimeSpan askWait) => new()
    {
        ["mcpServers"] = new JsonObject
        {
            [ServerName] = new JsonObject
            {
                ["type"] = "http", ["url"] = McpUrl,
                ["headers"] = new JsonObject { ["Authorization"] = "Bearer " + Token },
                ["timeout"] = (int)((askWait.TotalSeconds + 60) * 1000),
            },
        },
    };

    /// <summary>Writes the MCP config to a temp file (inline JSON gets mangled by PTY quoting); returns its path.</summary>
    public string WriteClaudeConfig(TimeSpan askWait)
    {
        var directory = Path.Combine(Path.GetTempPath(), "codechroma-mcp");
        var safe = new string(WorkspaceId.Select(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' ? c : '_').ToArray());
        var path = Path.Combine(directory, safe + ".json");
        var json = ClaudeConfig(askWait).ToJsonString();
        if (OperatingSystem.IsWindows())
        {
            Directory.CreateDirectory(directory);
            File.WriteAllText(path, json);
            return path;
        }
        Directory.CreateDirectory(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        using var stream = new FileStream(path, new FileStreamOptions
        {
            Mode = FileMode.Create, Access = FileAccess.Write, Share = FileShare.None,
            UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite,
        });
        using var writer = new StreamWriter(stream);
        writer.Write(json);
        return path;
    }
}
