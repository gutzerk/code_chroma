using CodeChroma.Bridge.Questions;

namespace CodeChroma.Bridge.Http;

/// <summary>The bridge wiring a hook subcommand reads from its environment: the bridge URL, the workspace token and the workspace id.</summary>
public sealed record HookEnv(string BaseUrl, string Token, string WorkspaceId)
{
    /// <summary>The wiring when the launcher exported all three variables, else null (the hook then does nothing).</summary>
    public static HookEnv? Wired()
    {
        var wiring = new HookEnv(Get(BridgeAddress.BridgeUrlEnv).TrimEnd('/'), Get(McpEndpoint.TokenEnv), Get(BridgeAddress.WorkspaceIdEnv));
        return wiring.BaseUrl.Length == 0 || wiring.Token.Length == 0 || wiring.WorkspaceId.Length == 0 ? null : wiring;
    }

    /// <summary>The CODECHROMA_* variable, falling back to the lower-cased spelling older builds used.</summary>
    public static string Get(string name) =>
        Environment.GetEnvironmentVariable(name) is { Length: > 0 } value ? value
        : Environment.GetEnvironmentVariable(string.Concat("codechroma_", name.AsSpan("CODECHROMA_".Length))) ?? "";
}
