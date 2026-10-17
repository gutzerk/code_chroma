using System.Net;
using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests.Updater;

public class UpdateCheckTests
{
    private static readonly string Hex = new('a', 64);

    private static readonly string[] LegacyAssets =
    [
        "CodeChroma-2.0.0-arm64.dmg", "CodeChroma-2.0.0-x64.dmg", "CodeChroma-Setup.exe", "CodeChroma-2.0.0-x64.AppImage",
    ];

    private static readonly string[] NativeAssets =
    [
        "CodeChroma-2.0.0-osx-arm64.zip", "CodeChroma-2.0.0-osx-x64.zip", "CodeChroma-2.0.0-win-x64.zip",
        "CodeChroma-2.0.0-win-x64-Installer.exe", "CodeChroma-2.0.0-linux-x86_64.AppImage",
    ];

    private static readonly string[] AllAssets = [.. LegacyAssets, .. NativeAssets];

    private const string Trusted = "https://github.com/gutzerk/code_chroma/releases/download/v2.0.0/";

    private static string Release(string tag, string[] assets, string urlBase = Trusted) =>
        $$"""{"tag_name":"{{tag}}","body":"notes","assets":[{{string.Join(",", assets.Select(a => $$"""{"name":"{{a}}","browser_download_url":"{{urlBase}}{{a}}"}"""))}}]}""";

    private static UpdateChecker Checker(Func<HttpRequestMessage, HttpResponseMessage> respond) =>
        new(StubHandler.Client(respond), tempDir: Path.GetTempPath());

    private static readonly ShellPlatform MacArm = new(ShellOs.MacOs, ShellArch.Arm64);

    [Theory]
    [InlineData(ShellOs.MacOs, ShellArch.Arm64, "CodeChroma-2.0.0-osx-arm64.zip")]
    [InlineData(ShellOs.MacOs, ShellArch.X64, "CodeChroma-2.0.0-osx-x64.zip")]
    [InlineData(ShellOs.Windows, ShellArch.X64, "CodeChroma-2.0.0-win-x64.zip")]
    [InlineData(ShellOs.Linux, ShellArch.X64, "CodeChroma-2.0.0-linux-x86_64.AppImage")]
    public async Task Prefers_the_native_package_over_the_electron_installer_on_every_platform(ShellOs os, ShellArch arch, string expected)
    {
        var checker = Checker(_ => StubHandler.Json(HttpStatusCode.OK, Release("v2.0.0", AllAssets)));

        var info = await checker.CheckAsync("1.0.0", new(os, arch));

        Assert.Equal(expected, info!.AssetName);
        Assert.Equal(AssetKind.Native, info.Kind);
        Assert.Equal(("v2.0.0", "notes"), (info.Version, info.Notes));
    }

    [Theory]
    [InlineData(ShellOs.MacOs, ShellArch.Arm64, "CodeChroma-2.0.0-arm64.dmg")]
    [InlineData(ShellOs.MacOs, ShellArch.X64, "CodeChroma-2.0.0-x64.dmg")]
    [InlineData(ShellOs.Windows, ShellArch.X64, "CodeChroma-Setup.exe")]
    [InlineData(ShellOs.Linux, ShellArch.X64, "CodeChroma-2.0.0-x64.AppImage")]
    public async Task A_release_with_only_electron_installers_is_still_reported_but_marked_legacy(ShellOs os, ShellArch arch, string expected)
    {
        var checker = Checker(_ => StubHandler.Json(HttpStatusCode.OK, Release("v2.0.0", LegacyAssets)));

        var info = await checker.CheckAsync("1.0.0", new(os, arch));

        Assert.Equal((expected, AssetKind.ElectronLegacy), (info!.AssetName, info.Kind));
    }

    [Theory]
    [InlineData("CodeChroma-2.0.0-x64-Setup.exe", true)]
    [InlineData("CodeChroma-Setup.exe", true)]
    [InlineData("CodeChroma-2.0.0-win-x64-Installer.exe", false)]
    [InlineData("CodeChroma-2.0.0-win-x64.zip.sha256", false)]
    [InlineData("Other-2.0.0-x64-Setup.exe", false)]
    public void Windows_selection_accepts_the_setup_names_and_ignores_the_velopack_installer(string asset, bool selected)
    {
        var match = AssetSelector.Select([new ReleaseAsset(asset, Trusted + asset)], new(ShellOs.Windows, ShellArch.X64));

        Assert.Equal(selected, match is not null);
    }

    [Theory]
    [InlineData(ShellOs.Windows, ShellArch.Arm64)]
    [InlineData(ShellOs.Linux, ShellArch.Arm64)]
    public async Task A_platform_without_an_installer_is_an_error_not_up_to_date(ShellOs os, ShellArch arch)
    {
        var checker = Checker(_ => StubHandler.Json(HttpStatusCode.OK, Release("v2.0.0", AllAssets)));

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => checker.CheckAsync("1.0.0", new(os, arch)));

        Assert.Contains("No installer", error.Message);
    }

    [Theory]
    [InlineData("https://dl.example.com/CodeChroma-2.0.0-osx-arm64.zip")]
    [InlineData("https://github.com/evil/repo/releases/download/v2.0.0/CodeChroma-2.0.0-osx-arm64.zip")]
    [InlineData("http://github.com/gutzerk/code_chroma/releases/download/v2.0.0/CodeChroma-2.0.0-osx-arm64.zip")]
    [InlineData("https://user:pw@github.com/gutzerk/code_chroma/releases/download/v2.0.0/CodeChroma-2.0.0-osx-arm64.zip")]
    public async Task An_asset_url_outside_this_repos_release_downloads_is_refused(string url)
    {
        var json = $$"""{"tag_name":"v2.0.0","assets":[{"name":"CodeChroma-2.0.0-osx-arm64.zip","browser_download_url":"{{url}}"}]}""";
        var checker = Checker(_ => StubHandler.Json(HttpStatusCode.OK, json));

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => checker.CheckAsync("1.0.0", MacArm));

        Assert.Contains("refusing", error.Message);
    }

    [Theory]
    [InlineData("""{"tag_name":"v3.0.0","prerelease":true,"assets":[]}""")]
    [InlineData("""{"tag_name":"v3.0.0","draft":true,"assets":[]}""")]
    [InlineData("""{"tag_name":"v3.0.0-beta.1","assets":[]}""")]
    public async Task Non_stable_releases_are_ignored(string json)
    {
        var checker = Checker(_ => StubHandler.Json(HttpStatusCode.OK, json));

        Assert.Null(await checker.CheckAsync("1.0.0", MacArm));
    }

    [Theory]
    [InlineData("null")]
    [InlineData("{}")]
    [InlineData("""{"tag_name":"v2.0.0junk","assets":[]}""")]
    [InlineData("""{"tag_name":"v2.0.0","assets":[null]}""")]
    public async Task Malformed_responses_are_rejected(string json)
    {
        var checker = Checker(_ => StubHandler.Json(HttpStatusCode.OK, json));

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => checker.CheckAsync("1.0.0", MacArm));

        Assert.Contains("Malformed", error.Message);
    }

    [Fact]
    public async Task Reports_the_latest_version_even_when_already_up_to_date()
    {
        var checker = Checker(_ => StubHandler.Json(HttpStatusCode.OK, Release("v2.0.0", AllAssets)));
        string? latest = null;

        var info = await checker.CheckAsync("2.0.0", MacArm, v => latest = v);

        Assert.Null(info);
        Assert.Equal("v2.0.0", latest);
    }

    [Fact]
    public async Task A_server_error_is_an_error_not_no_update()
    {
        var checker = Checker(_ => StubHandler.Json(HttpStatusCode.InternalServerError, "{}"));

        var error = await Assert.ThrowsAsync<HttpRequestException>(() => checker.CheckAsync("1.0.0", MacArm));

        Assert.Contains("500", error.Message);
    }

    [Fact]
    public async Task Rate_limit_carries_the_reset_time()
    {
        var now = DateTimeOffset.FromUnixTimeSeconds(1_000_000);
        var reset = now.AddMinutes(12).ToUnixTimeSeconds();
        var client = StubHandler.Client(_ =>
        {
            var response = StubHandler.Json(HttpStatusCode.Forbidden, """{"message":"API rate limit exceeded"}""");
            response.Headers.Add("x-ratelimit-remaining", "0");
            response.Headers.Add("x-ratelimit-reset", reset.ToString());
            return response;
        });
        var checker = new UpdateChecker(client, tempDir: Path.GetTempPath(), clock: () => now);

        var error = await Assert.ThrowsAsync<GitHubRateLimitException>(() => checker.CheckAsync("1.0.0", MacArm));

        Assert.Equal(DateTimeOffset.FromUnixTimeSeconds(reset), error.RetryAt);
        Assert.Contains("Resets in 12 minutes", error.Message);
    }

    [Fact]
    public async Task A_304_reuses_the_cached_release_and_a_rate_limit_falls_back_to_it()
    {
        var sentTags = new List<string?>();
        var step = 0;
        var client = StubHandler.Client(request =>
        {
            sentTags.Add(request.Headers.TryGetValues("If-None-Match", out var v) ? v.Single() : null);
            step++;
            if (step == 1)
            {
                var ok = StubHandler.Json(HttpStatusCode.OK, Release("v2.0.0", NativeAssets));
                ok.Headers.ETag = new System.Net.Http.Headers.EntityTagHeaderValue("\"abc\"");
                return ok;
            }
            if (step == 2) return new HttpResponseMessage(HttpStatusCode.NotModified);
            var limited = StubHandler.Json(HttpStatusCode.Forbidden, """{"message":"API rate limit exceeded"}""");
            limited.Headers.Add("x-ratelimit-remaining", "0");
            return limited;
        });
        var checker = new UpdateChecker(client, tempDir: Path.GetTempPath());

        var first = await checker.CheckAsync("1.0.0", MacArm);
        var second = await checker.CheckAsync("1.0.0", MacArm);
        var third = await checker.CheckAsync("1.0.0", MacArm);

        Assert.Equal([null, "\"abc\"", "\"abc\""], sentTags);
        Assert.Equal(["v2.0.0", "v2.0.0", "v2.0.0"], [first!.Version, second!.Version, third!.Version]);
    }

    [Fact]
    public async Task Digest_comes_from_the_sidecar_when_the_asset_has_none()
    {
        var checker = Checker(request => request.RequestUri!.AbsolutePath.EndsWith(".sha256")
            ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent($"{Hex}  CodeChroma-2.0.0-osx-arm64.zip") }
            : StubHandler.Json(HttpStatusCode.OK, Release("v2.0.0", ["CodeChroma-2.0.0-osx-arm64.zip", "CodeChroma-2.0.0-osx-arm64.zip.sha256"])));

        var info = await checker.CheckAsync("1.0.0", MacArm);

        Assert.Equal(Hex, info!.Sha256);
    }

    [Fact]
    public async Task A_newer_release_without_any_digest_is_still_reported_as_an_update()
    {
        var checker = Checker(_ => StubHandler.Json(HttpStatusCode.OK, Release("v2.0.0", ["CodeChroma-2.0.0-osx-arm64.zip"])));

        var info = await checker.CheckAsync("1.0.0", MacArm);

        Assert.Null(info!.Sha256);
        Assert.Equal("v2.0.0", info.Version);
    }

    [Theory]
    [InlineData("sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", true)]
    [InlineData("md5:abc", false)]
    [InlineData(null, false)]
    public void Asset_digest_needs_the_sha256_prefix(string? digest, bool valid)
    {
        Assert.Equal(valid, AssetSelector.DigestHex(digest) is not null);
    }

    [Theory]
    [InlineData("CodeChroma-1.0.0.dmg", "CodeChroma-1.0.0.dmg")]
    [InlineData("../../etc/passwd", "passwd")]
    [InlineData("a b$c.dmg", "a_b_c.dmg")]
    public void Local_asset_names_cannot_escape_the_download_directory(string remote, string expected)
    {
        Assert.Equal(expected, AssetSelector.SafeAssetName(remote));
    }
}
