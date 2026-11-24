namespace CodeChroma.Shell;

/// <summary>Which off-bridge links the canvas may hand to the OS: the web, plus the Slack app's deep links (unread messages panel).</summary>
public static class ExternalLinks
{
    private static readonly HashSet<string> Schemes = ["http", "https", "slack"];

    public static bool CanOpen(Uri target) => target.IsAbsoluteUri && Schemes.Contains(target.Scheme);
}
