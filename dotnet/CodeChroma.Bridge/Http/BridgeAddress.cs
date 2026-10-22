using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

namespace CodeChroma.Bridge.Http;

/// <summary>Where this bridge can be reached from a process on the same machine.</summary>
public static class BridgeAddress
{
    public const string WorkspaceIdEnv = "CODECHROMA_WORKSPACE_ID";
    public const string BridgeUrlEnv = "CODECHROMA_BRIDGE_URL";

    /// <summary>The loopback URL the server listens on, or null before it is up.</summary>
    public static string? Local(IServer server)
    {
        var address = server.Features.Get<IServerAddressesFeature>()?.Addresses.FirstOrDefault();
        return address?.Replace("[::]", "127.0.0.1").Replace("0.0.0.0", "127.0.0.1").Replace("+", "127.0.0.1").Replace("*", "127.0.0.1").TrimEnd('/');
    }

    /// <summary>Exports the workspace id and this bridge's URL so skills and check scripts address the right bridge.</summary>
    public static void ExportIdentity(IDictionary<string, string> env, string workspaceId, string? bridgeUrl)
    {
        env[WorkspaceIdEnv] = workspaceId;
        if (!string.IsNullOrEmpty(bridgeUrl)) env[BridgeUrlEnv] = bridgeUrl;
    }
}
