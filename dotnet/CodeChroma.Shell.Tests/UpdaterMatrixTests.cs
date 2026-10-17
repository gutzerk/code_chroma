using System.Net;
using System.Security.Cryptography;
using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests;

public enum Outcome { DigestOk, DigestMismatch, Oversized, AttestationFails, AttestationRequiredButUnavailable, HttpFailure }

public class UpdaterMatrixTests
{
    private static readonly byte[] Payload = "installer-bytes"u8.ToArray();
    private static readonly string Good = Convert.ToHexString(SHA256.HashData(Payload)).ToLowerInvariant();

    private sealed class FakeVerifier(bool canVerify, bool fail) : IAttestationVerifier
    {
        public bool CanVerify => canVerify;
        public List<string> Verified { get; } = [];

        public Task VerifyAsync(string sha256Hex, CancellationToken ct)
        {
            Verified.Add(sha256Hex);
            return fail ? throw new InvalidOperationException("signed attestation does not vouch for the artifact") : Task.CompletedTask;
        }
    }

    public static IEnumerable<object[]> Matrix()
    {
        var platforms = new (ShellOs, ShellArch, string)[]
        {
            (ShellOs.MacOs, ShellArch.Arm64, "CodeChroma-2.0.0-arm64.dmg"),
            (ShellOs.MacOs, ShellArch.X64, "CodeChroma-2.0.0-x64.dmg"),
            (ShellOs.Windows, ShellArch.X64, "CodeChroma-Setup.exe"),
            (ShellOs.Linux, ShellArch.X64, "CodeChroma-2.0.0-x64.AppImage"),
        };
        foreach (var (os, arch, asset) in platforms)
            foreach (var outcome in Enum.GetValues<Outcome>())
                yield return [os, arch, asset, outcome];
    }

    [Theory]
    [MemberData(nameof(Matrix))]
    public async Task Download_outcome_per_platform(ShellOs os, ShellArch arch, string asset, Outcome outcome)
    {
        using var temp = new TempDir();
        var verifier = new FakeVerifier(canVerify: outcome != Outcome.AttestationRequiredButUnavailable, fail: outcome == Outcome.AttestationFails);
        var body = outcome == Outcome.Oversized ? new byte[64] : Payload;
        var client = StubHandler.Client(_ => outcome == Outcome.HttpFailure
            ? new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
            : new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(body) });
        var downloader = new UpdateDownloader(client, verifier, maxBytes: outcome == Outcome.Oversized ? 16 : 1_000_000, requireAttestation: true);
        var sha = outcome == Outcome.DigestMismatch ? new string('0', 64) : Good;
        var info = new UpdateInfo("v2.0.0", asset, temp.Sub(asset), sha, "https://dl/" + asset, null);

        var attempt = downloader.DownloadAsync(info);

        var expectedError = outcome switch
        {
            Outcome.DigestMismatch => "integrity",
            Outcome.Oversized => "too large",
            Outcome.AttestationFails => "attestation",
            Outcome.AttestationRequiredButUnavailable => "attestation",
            Outcome.HttpFailure => "503",
            _ => null,
        };
        if (expectedError is null)
        {
            var result = await attempt;
            Assert.Equal(Provenance.Attested, result.Provenance);
            Assert.Equal(Payload, await File.ReadAllBytesAsync(info.DownloadPath));
            Assert.Equal([Good], verifier.Verified);
        }
        else
        {
            var error = await Assert.ThrowsAsync<InvalidOperationException>(() => attempt);
            Assert.Contains(expectedError, error.Message);
            Assert.False(File.Exists(info.DownloadPath));
            Assert.False(File.Exists(info.DownloadPath + ".part"));
        }
    }

    [Fact]
    public async Task Checksum_only_path_is_flagged_when_attestation_is_not_required()
    {
        using var temp = new TempDir();
        var client = StubHandler.Client(_ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Payload) });
        var downloader = new UpdateDownloader(client, new ChecksumOnlyAttestationVerifier());
        var info = new UpdateInfo("v2.0.0", "a.dmg", temp.Sub("a.dmg"), Good, "https://dl/a.dmg", null);

        var result = await downloader.DownloadAsync(info);

        Assert.Equal(Provenance.ChecksumOnly, result.Provenance);
    }

    [Fact]
    public async Task A_release_without_a_digest_is_refused_before_any_download()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK));
        var downloader = new UpdateDownloader(new HttpClient(handler), new ChecksumOnlyAttestationVerifier());

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => downloader.DownloadAsync(new("v2", "a.dmg", "x", null, null, null)));

        Assert.Contains("no SHA-256", error.Message);
        Assert.Empty(handler.Urls);
    }

    [Fact]
    public async Task An_already_verified_file_is_not_downloaded_again()
    {
        using var temp = new TempDir();
        var path = temp.Sub("a.dmg");
        await File.WriteAllBytesAsync(path, Payload);
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK));
        var downloader = new UpdateDownloader(new HttpClient(handler), new ChecksumOnlyAttestationVerifier());

        var result = await downloader.DownloadAsync(new("v2", "a.dmg", path, Good, "https://dl/a.dmg", null));

        Assert.Equal(path, result.Path);
        Assert.Empty(handler.Urls);
    }

    [Theory]
    [InlineData(ShellOs.MacOs, ShellArch.Arm64, InstallKind.MacSwap, false)]
    [InlineData(ShellOs.MacOs, ShellArch.X64, InstallKind.MacSwap, false)]
    [InlineData(ShellOs.Windows, ShellArch.X64, InstallKind.WindowsSetup, false)]
    [InlineData(ShellOs.Linux, ShellArch.X64, InstallKind.LinuxAppImageReplace, true)]
    public void Install_plan_per_platform(ShellOs os, ShellArch arch, InstallKind kind, bool relaunchInProcess)
    {
        var plan = InstallPlanner.For(new(os, arch));

        Assert.Equal(new InstallPlan(kind, relaunchInProcess), plan);
    }

    [Fact]
    public void Unsupported_platforms_have_no_install_path() =>
        Assert.Throws<NotSupportedException>(() => InstallPlanner.For(new(ShellOs.Windows, ShellArch.Arm64)));

    [Fact]
    public async Task The_AppImage_is_replaced_without_leaving_temp_files()
    {
        using var temp = new TempDir();
        var current = temp.Sub("CodeChroma.AppImage");
        var staged = temp.Sub("download.AppImage");
        await File.WriteAllTextAsync(current, "old");
        await File.WriteAllTextAsync(staged, "new");

        AppImageInstaller.Replace(staged, current);

        Assert.Equal("new", await File.ReadAllTextAsync(current));
        Assert.Equal(2, Directory.GetFileSystemEntries(temp.Path).Length);
    }
}
