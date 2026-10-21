using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

namespace CodeChroma.Bridge.Http;

/// <summary>Where this bridge can be reached from a process on the same machine.</summary>
public static class BridgeAddress
{
    /// <summary>The loopback URL the server listens on, or null before it is up.</summary>
    public static string? Local(IServer server)
    {
        var address = server.Features.Get<IServerAddressesFeature>()?.Addresses.FirstOrDefault();
        return address?.Replace("[::]", "127.0.0.1").Replace("0.0.0.0", "127.0.0.1").Replace("+", "127.0.0.1").Replace("*", "127.0.0.1").TrimEnd('/');
    }
}
