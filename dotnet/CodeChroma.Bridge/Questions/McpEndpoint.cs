using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Questions;

/// <summary>Where one workspace's agent reaches the bridge: its base URL and bearer token (questions/launch.py).</summary>
public sealed class McpEndpoint(string workspaceId, string baseUrl, string token, TimeSpan askWait)
{
    public const string UrlEnv = "CODECHROMA_BRIDGE_URL";
    public const string TokenEnv = "CODECHROMA_QUESTION_TOKEN";

    private readonly Lazy<string> _configPath = new(() => WriteConfig(workspaceId, baseUrl, token, askWait));

    public string WorkspaceId => workspaceId;
    public string BaseUrl => baseUrl;
    public string Token => token;
    public string McpUrl => baseUrl + "/mcp/";

    /// <summary>Env for the agent process, read by the AskUserQuestion hook (the workspace id comes from BridgeAddress.ExportIdentity).</summary>
    public IReadOnlyDictionary<string, string> Env() => new Dictionary<string, string> { [UrlEnv] = baseUrl, [TokenEnv] = token };

    /// <summary>The --mcp-config file, written on first use (inline JSON gets mangled by PTY quoting).</summary>
    public string ConfigPath => _configPath.Value;

    private static string WriteConfig(string workspaceId, string baseUrl, string token, TimeSpan askWait)
    {
        var path = TempFiles.JsonPath("codechroma-mcp", workspaceId);
        var config = McpJsonRpc.HttpServerConfig(QuestionMcp.ServerName, baseUrl + "/mcp/", token, (int)(askWait.TotalSeconds + 60) * 1000);
        TempFiles.Write(path, config.ToJsonString());
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        return path;
    }
}
