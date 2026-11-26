namespace CodeChroma.Shell;

/// <summary>Which off-bridge links the canvas may hand to the OS: the web, plus the Slack app's deep links (unread messages panel).</summary>
public static class ExternalLinks
{
    private static readonly HashSet<string> Schemes = ["http", "https", "slack"];

    public static bool CanOpen(Uri target) => target.IsAbsoluteUri && Schemes.Contains(target.Scheme);

    /// <summary>True when the URL is on the given bridge origin (scheme, host and port all match).</summary>
    public static bool IsOnOrigin(Uri? target, string? origin) =>
        target is { IsAbsoluteUri: true } && origin is not null && Uri.TryCreate(origin, UriKind.Absolute, out var root)
        && target.Scheme == root.Scheme && target.Host == root.Host && target.Port == root.Port;

    /// <summary>Whether a WebView new-window request goes to the OS; never for the tab's own bridge or about: pages, which macOS also reports for in-app loads.</summary>
    public static bool OpensExternally(Uri target, string? bridgeOrigin) =>
        target.Scheme != "about" && !IsOnOrigin(target, bridgeOrigin) && CanOpen(target);
}
