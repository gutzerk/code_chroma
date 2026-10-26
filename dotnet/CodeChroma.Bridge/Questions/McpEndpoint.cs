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
        var safe = new string(WorkspaceId.Select(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_' ? c : '_').ToArray());
        var path = Path.Combine(PrivateDirectory(), safe + ".json");
        var json = ClaudeConfig(askWait).ToJsonString();
        if (OperatingSystem.IsWindows())
        {
            File.WriteAllText(path, json);
            return path;
        }
        using var stream = new FileStream(path, new FileStreamOptions
        {
            Mode = FileMode.Create, Access = FileAccess.Write, Share = FileShare.None,
            UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite,
        });
        using var writer = new StreamWriter(stream);
        writer.Write(json);
        return path;
    }

    private static readonly object DirectoryGate = new();
    private static string? _directory;

    /// <summary>A per-process 0700 dir (mkdtemp); a fixed shared /tmp path can be pre-planted by another user.</summary>
    private static string PrivateDirectory()
    {
        lock (DirectoryGate)
        {
            if (_directory is null || !Directory.Exists(_directory)) _directory = Directory.CreateTempSubdirectory("codechroma-mcp-").FullName;
            return _directory;
        }
    }
}
