using System.Net;
using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests;

public class UpdateCheckTests
{
    private static readonly string Hex = new('a', 64);

    private static readonly string[] AllAssets =
    [
        "CodeChroma-2.0.0-arm64.dmg", "CodeChroma-2.0.0-x64.dmg", "CodeChroma-Setup.exe", "CodeChroma-2.0.0-x64.AppImage",
    ];

    private static string Release(string tag, string[] assets) =>
        $$"""{"tag_name":"{{tag}}","body":"notes","assets":[{{string.Join(",", assets.Select(a => $$"""{"name":"{{a}}","browser_download_url":"https://dl/{{a}}"}"""))}}]}""";

    private static UpdateChecker Checker(Func<HttpRequestMessage, HttpResponseMessage> respond) =>
        new(StubHandler.Client(respond), tempDir: Path.GetTempPath());

    private static readonly ShellPlatform MacArm = new(ShellOs.MacOs, ShellArch.Arm64);

    public static IEnumerable<object[]> InstallerPerPlatform() =>
    [
        [ShellOs.MacOs, ShellArch.Arm64, "CodeChroma-2.0.0-arm64.dmg"],
        [ShellOs.MacOs, ShellArch.X64, "CodeChroma-2.0.0-x64.dmg"],
        [ShellOs.Windows, ShellArch.X64, "CodeChroma-Setup.exe"],
        [ShellOs.Linux, ShellArch.X64, "CodeChroma-2.0.0-x64.AppImage"],
    ];

    [Theory]
    [MemberData(nameof(InstallerPerPlatform))]
    public async Task Picks_the_installer_for_each_platform(ShellOs os, ShellArch arch, string expected)
    {
        var checker = Checker(_ => StubHandler.Json(HttpStatusCode.OK, Release("v2.0.0", AllAssets)));

        var info = await checker.CheckAsync("1.0.0", new(os, arch));

        Assert.Equal(expected, info!.AssetName);
        Assert.Equal("v2.0.0", info.Version);
        Assert.Equal("notes", info.Notes);
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
    public async Task Digest_comes_from_the_sidecar_when_the_asset_has_none()
    {
        var checker = Checker(request => request.RequestUri!.AbsolutePath.EndsWith(".sha256")
            ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent($"{Hex}  CodeChroma-2.0.0-arm64.dmg") }
            : StubHandler.Json(HttpStatusCode.OK, Release("v2.0.0", ["CodeChroma-2.0.0-arm64.dmg", "CodeChroma-2.0.0-arm64.dmg.sha256"])));

        var info = await checker.CheckAsync("1.0.0", MacArm);

        Assert.Equal(Hex, info!.Sha256);
    }

    [Fact]
    public async Task A_newer_release_without_any_digest_is_still_reported_as_an_update()
    {
        var checker = Checker(_ => StubHandler.Json(HttpStatusCode.OK, Release("v2.0.0", ["CodeChroma-2.0.0-arm64.dmg"])));

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
