using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace CodeChroma.Shell;

public sealed record ReleaseAsset(string Name, string BrowserDownloadUrl, string? Digest = null);

public sealed record AssetMatch(string Name, string? Sha256);

public sealed record UpdateInfo(string Version, string AssetName, string DownloadPath, string? Sha256, string? DownloadUrl, string? Notes);

public sealed class GitHubRateLimitException(string message, DateTimeOffset retryAt) : Exception(message)
{
    public DateTimeOffset RetryAt { get; } = retryAt;
}

public static partial class AssetSelector
{
    private static readonly Dictionary<ShellPlatform, string> Suffixes = new()
    {
        [new(ShellOs.MacOs, ShellArch.Arm64)] = "-arm64.dmg",
        [new(ShellOs.MacOs, ShellArch.X64)] = "-x64.dmg",
        [new(ShellOs.Windows, ShellArch.X64)] = "-Setup.exe",
        [new(ShellOs.Linux, ShellArch.X64)] = "-x64.AppImage",
    };

    [GeneratedRegex("^sha256:([0-9a-f]{64})$", RegexOptions.IgnoreCase)]
    private static partial Regex DigestPattern();

    public static AssetMatch? Select(IReadOnlyList<ReleaseAsset> assets, ShellPlatform platform)
    {
        if (!Suffixes.TryGetValue(platform, out var suffix)) return null;
        var asset = assets.FirstOrDefault(a => a.Name.StartsWith("CodeChroma-", StringComparison.Ordinal)
            && a.Name.EndsWith(suffix, StringComparison.Ordinal)
            && (platform.Os != ShellOs.Windows || a.Name == "CodeChroma-Setup.exe" || a.Name.EndsWith("-x64-Setup.exe", StringComparison.Ordinal)));
        return asset is null ? null : new AssetMatch(asset.Name, DigestHex(asset.Digest));
    }

    public static string? DigestHex(string? digest) =>
        digest is null ? null : DigestPattern().Match(digest) is { Success: true } m ? m.Groups[1].Value : null;

    public static string SafeAssetName(string name) => Regex.Replace(Path.GetFileName(name), "[^0-9A-Za-z._-]", "_");
}

public sealed partial class UpdateChecker(HttpClient http, string repo = "gutzerk/code_chroma", Func<DateTimeOffset>? clock = null, string? tempDir = null)
{
    private readonly Func<DateTimeOffset> now = clock ?? (() => DateTimeOffset.UtcNow);
    private readonly string temp = tempDir ?? Path.GetTempPath();

    public async Task<UpdateInfo?> CheckAsync(string currentVersion, ShellPlatform platform, Action<string>? onLatest = null, CancellationToken ct = default)
    {
        using var response = await Send($"https://api.github.com/repos/{repo}/releases/latest", ct);
        if (!response.IsSuccessStatusCode)
        {
            if (await IsRateLimited(response)) throw RateLimit(response);
            throw new HttpRequestException($"GitHub API responded {(int)response.StatusCode}");
        }

        var (tag, notes, assets, stable) = Parse(await response.Content.ReadAsStringAsync(ct));
        if (!stable) return null;
        onLatest?.Invoke(tag);
        if (SemVer.CompareTags(tag, currentVersion) <= 0) return null;

        var match = AssetSelector.Select(assets, platform)
            ?? throw new InvalidOperationException($"No installer for {platform.Os}/{platform.Arch}. Install manually from GitHub Releases.");
        var sha = match.Sha256 ?? await SidecarHex(match.Name, assets, ct);
        var url = assets.First(a => a.Name == match.Name).BrowserDownloadUrl;
        return new UpdateInfo(tag, match.Name, Path.Combine(temp, AssetSelector.SafeAssetName(match.Name)), sha, url, notes);
    }

    private Task<HttpResponseMessage> Send(string url, CancellationToken ct)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.UserAgent.ParseAdd("code-chroma-desktop");
        return http.SendAsync(request, ct);
    }

    private static (string Tag, string? Notes, List<ReleaseAsset> Assets, bool Stable) Parse(string json)
    {
        const string malformed = "Malformed GitHub release response. Try again or visit GitHub Releases.";
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) throw new InvalidOperationException(malformed);
            if (!root.TryGetProperty("tag_name", out var tagElement) || tagElement.ValueKind != JsonValueKind.String
                || !SemVer.TryParse(tagElement.GetString(), out var version)) throw new InvalidOperationException(malformed);
            if (!root.TryGetProperty("assets", out var assetsElement) || assetsElement.ValueKind != JsonValueKind.Array) throw new InvalidOperationException(malformed);
            var assets = new List<ReleaseAsset>();
            foreach (var item in assetsElement.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object || Str(item, "name") is not { } name || Str(item, "browser_download_url") is not { } url)
                    throw new InvalidOperationException(malformed);
                assets.Add(new ReleaseAsset(name, url, Str(item, "digest")));
            }
            var stable = !Flag(root, "draft") && !Flag(root, "prerelease") && !version!.IsPrerelease;
            var body = Str(root, "body")?.Trim();
            return (tagElement.GetString()!, string.IsNullOrEmpty(body) ? null : body[..Math.Min(body.Length, 20_000)], assets, stable);
        }
        catch (JsonException)
        {
            throw new InvalidOperationException(malformed);
        }
    }

    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static bool Flag(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    private async Task<string?> SidecarHex(string assetName, List<ReleaseAsset> assets, CancellationToken ct)
    {
        var sidecar = assets.FirstOrDefault(a => a.Name == assetName + ".sha256");
        if (sidecar is null) return null;
        try
        {
            using var response = await Send(sidecar.BrowserDownloadUrl, ct);
            if (!response.IsSuccessStatusCode) return null;
            var match = SidecarPattern().Match((await response.Content.ReadAsStringAsync(ct)).Trim());
            return match.Success ? match.Groups[1].Value : null;
        }
        catch (HttpRequestException)
        {
            return null;
        }
    }

    [GeneratedRegex(@"^([0-9a-f]{64})\s+")]
    private static partial Regex SidecarPattern();

    private static async Task<bool> IsRateLimited(HttpResponseMessage response)
    {
        if ((int)response.StatusCode == 429 || Header(response, "x-ratelimit-remaining") == "0") return true;
        if (response.StatusCode != System.Net.HttpStatusCode.Forbidden) return false;
        return Regex.IsMatch(await response.Content.ReadAsStringAsync(), "rate limit", RegexOptions.IgnoreCase);
    }

    private static string? Header(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues(name, out var values) ? values.FirstOrDefault() : null;

    private GitHubRateLimitException RateLimit(HttpResponseMessage response)
    {
        var current = now();
        DateTimeOffset retryAt;
        var hasReset = long.TryParse(Header(response, "x-ratelimit-reset"), CultureInfo.InvariantCulture, out var reset)
            && DateTimeOffset.FromUnixTimeSeconds(reset) > current;
        if (hasReset) retryAt = DateTimeOffset.FromUnixTimeSeconds(reset);
        else if (double.TryParse(response.Headers.RetryAfter?.Delta?.TotalSeconds.ToString(CultureInfo.InvariantCulture) ?? Header(response, "retry-after"), CultureInfo.InvariantCulture, out var seconds) && seconds > 0)
            retryAt = current.AddSeconds(seconds);
        else retryAt = current.AddSeconds(60);

        var minutes = (int)Math.Ceiling((retryAt - current).TotalMinutes);
        var delay = minutes <= 1 ? "about 1 minute" : $"{minutes} minutes";
        var message = hasReset
            ? $"GitHub API rate limit reached (unauthenticated). Resets in {delay}. Update manually from GitHub Releases."
            : $"GitHub API rate limit reached (unauthenticated). Try again in {delay} or update manually from GitHub Releases.";
        return new GitHubRateLimitException(message, retryAt);
    }
}
