namespace CodeChroma.Bridge.Http;

/// <summary>Refuses unsafe-method HTTP (403) and any WebSocket handshake from a foreign Origin.</summary>
public sealed class OriginGuard(RequestDelegate next, IReadOnlySet<string> allowedOrigins)
{
    private static readonly HashSet<string> UnsafeMethods = ["POST", "PUT", "PATCH", "DELETE"];
    private static readonly HashSet<string> LoopbackHosts = ["localhost", "127.0.0.1", "::1"];

    public async Task Invoke(HttpContext context)
    {
        var isSocket = context.WebSockets.IsWebSocketRequest;
        if ((isSocket || UnsafeMethods.Contains(context.Request.Method))
            && context.Request.Headers.Origin.ToString() is { Length: > 0 } origin
            && IsCrossOrigin(origin, context.Request.Headers.Host.ToString(), allowedOrigins))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            if (!isSocket)
            {
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync("""{"detail":"cross-origin request refused"}""");
            }
            return;
        }
        await next(context);
    }

    /// <summary>Whether the origin is neither explicitly allowed nor this loopback server itself.</summary>
    public static bool IsCrossOrigin(string origin, string host, IReadOnlySet<string> allowed)
    {
        if (allowed.Contains(origin)) return false;
        var netloc = Netloc(origin);
        // Same netloc alone is not enough: a DNS-rebound page sends Origin and Host as its own name.
        return netloc != host || !LoopbackHosts.Contains(Hostname(netloc));
    }

    private static string Netloc(string url)
    {
        var rest = url.Contains("://", StringComparison.Ordinal) ? url[(url.IndexOf("://", StringComparison.Ordinal) + 3)..] : url;
        var end = rest.IndexOfAny(['/', '?', '#']);
        return end < 0 ? rest : rest[..end];
    }

    private static string Hostname(string netloc)
    {
        var at = netloc.LastIndexOf('@');
        var hostPort = at < 0 ? netloc : netloc[(at + 1)..];
        if (hostPort.StartsWith('['))
        {
            var close = hostPort.IndexOf(']');
            return close < 0 ? hostPort : hostPort[1..close].ToLowerInvariant();
        }
        var colon = hostPort.LastIndexOf(':');
        return (colon < 0 ? hostPort : hostPort[..colon]).ToLowerInvariant();
    }
}
