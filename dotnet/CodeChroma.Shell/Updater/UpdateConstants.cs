using System.Text.RegularExpressions;

namespace CodeChroma.Shell;

/// <summary>Single source for the repo slug, URLs, intervals and the user-facing verification wording.</summary>
public static partial class UpdateConstants
{
    public const string Repo = "gutzerk/code_chroma";
    public const string UserAgent = "code-chroma-desktop";
    public static readonly TimeSpan PeriodicCheck = TimeSpan.FromHours(6);
    public static readonly TimeSpan FocusMinGap = TimeSpan.FromHours(1);

    /// <summary>Shown wherever an update is offered or ready; the C# updater verifies the SHA-256 only (016 decision).</summary>
    public const string ChecksumOnlyNotice =
        "This update is verified by its SHA-256 checksum only. It is not signed or attested, so the checksum protects against a corrupted download but not against a compromised release. Compare it with the checksum published on GitHub Releases if that matters to you.";

    public const string ChecksumOnlyBadge = "Checksum only (not signed)";

    [GeneratedRegex(@"^https://github\.com/(?<repo>[^/]+/[^/]+)/releases/(?:latest/)?download/[^?#\s]+$")]
    private static partial Regex DownloadUrlPattern();

    /// <summary>True only for a credential-free github.com release-download URL of <paramref name="repo"/>.</summary>
    public static bool IsTrustedDownloadUrl(string? url, string repo = Repo) =>
        url is not null && DownloadUrlPattern().Match(url) is { Success: true } m
        && !url.Split('/').Any(segment => segment is ".." or "." || segment.Contains("%2e", StringComparison.OrdinalIgnoreCase))
        && string.Equals(m.Groups["repo"].Value, repo, StringComparison.Ordinal);
}
