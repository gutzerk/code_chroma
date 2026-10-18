using System.Net;
using System.Security.Cryptography;
using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests.Updater;

public enum Outcome { DigestOk, DigestMismatch, Oversized, AttestationFails, AttestationRequiredButUnavailable, HttpFailure, UntrustedUrl }

public class UpdaterMatrixTests
{
    private static readonly byte[] Payload = "installer-bytes"u8.ToArray();
    private static readonly string Good = Convert.ToHexString(SHA256.HashData(Payload)).ToLowerInvariant();
    private const string Url = "https://github.com/gutzerk/code_chroma/releases/download/v2.0.0/CodeChroma-2.0.0-win-x64.zip";

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

    [Theory]
    [InlineData(Outcome.DigestOk)]
    [InlineData(Outcome.DigestMismatch)]
    [InlineData(Outcome.Oversized)]
    [InlineData(Outcome.AttestationFails)]
    [InlineData(Outcome.AttestationRequiredButUnavailable)]
    [InlineData(Outcome.HttpFailure)]
    [InlineData(Outcome.UntrustedUrl)]
    public async Task Download_outcome_with_a_required_attestation(Outcome outcome)
    {
        using var temp = new TempDir();
        var verifier = new FakeVerifier(canVerify: outcome != Outcome.AttestationRequiredButUnavailable, fail: outcome == Outcome.AttestationFails);
        var body = outcome == Outcome.Oversized ? new byte[64] : Payload;
        var client = StubHandler.Client(_ => outcome == Outcome.HttpFailure
            ? new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
            : new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(body) });
        var downloader = new UpdateDownloader(client, verifier, maxBytes: outcome == Outcome.Oversized ? 16 : 1_000_000, requireAttestation: true);
        var sha = outcome == Outcome.DigestMismatch ? new string('0', 64) : Good;
        var url = outcome == Outcome.UntrustedUrl ? "https://evil.example.com/CodeChroma-2.0.0-win-x64.zip" : Url;
        var info = new UpdateInfo("v2.0.0", "CodeChroma-2.0.0-win-x64.zip", temp.Sub("a.zip"), sha, url, null);

        var attempt = downloader.DownloadAsync(info);

        var expectedError = outcome switch
        {
            Outcome.DigestMismatch => "integrity",
            Outcome.Oversized => "too large",
            Outcome.AttestationFails => "attestation",
            Outcome.AttestationRequiredButUnavailable => "attestation",
            Outcome.HttpFailure => "503",
            Outcome.UntrustedUrl => "refusing",
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
        var info = new UpdateInfo("v2.0.0", "a.zip", temp.Sub("a.zip"), Good, Url, null);

        var result = await downloader.DownloadAsync(info);

        Assert.Equal(Provenance.ChecksumOnly, result.Provenance);
    }

    [Fact]
    public async Task A_release_without_a_digest_is_refused_before_any_download()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK));
        var downloader = new UpdateDownloader(new HttpClient(handler), new ChecksumOnlyAttestationVerifier());

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => downloader.DownloadAsync(new("v2", "a.zip", "x", null, null, null)));

        Assert.Contains("no SHA-256", error.Message);
        Assert.Empty(handler.Urls);
    }

    [Fact]
    public async Task An_already_verified_file_is_not_downloaded_again()
    {
        using var temp = new TempDir();
        var path = temp.Sub("a.zip");
        await File.WriteAllBytesAsync(path, Payload);
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK));
        var downloader = new UpdateDownloader(new HttpClient(handler), new ChecksumOnlyAttestationVerifier());

        var result = await downloader.DownloadAsync(new("v2", "a.zip", path, Good, Url, null));

        Assert.Equal(path, result.Path);
        Assert.Empty(handler.Urls);
    }

    [Theory]
    [InlineData(ShellOs.MacOs, ShellArch.Arm64, InstallKind.MacSwap)]
    [InlineData(ShellOs.MacOs, ShellArch.X64, InstallKind.MacSwap)]
    [InlineData(ShellOs.Windows, ShellArch.X64, InstallKind.WindowsSwap)]
    [InlineData(ShellOs.Linux, ShellArch.X64, InstallKind.LinuxAppImageReplace)]
    public void Every_platform_swaps_through_a_helper_that_needs_the_app_to_exit(ShellOs os, ShellArch arch, InstallKind kind)
    {
        var plan = InstallPlanner.For(new(os, arch));

        Assert.Equal(new InstallPlan(kind, ExitForHelper: true), plan);
    }

    [Fact]
    public void Unsupported_platforms_have_no_install_path() =>
        Assert.Throws<NotSupportedException>(() => InstallPlanner.For(new(ShellOs.Windows, ShellArch.Arm64)));
}
