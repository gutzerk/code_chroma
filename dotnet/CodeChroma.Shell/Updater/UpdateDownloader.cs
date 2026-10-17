using System.Security.Cryptography;

namespace CodeChroma.Shell;

public enum Provenance
{
    /// <summary>Only the SHA-256 from the release was checked; no signed provenance. Surface this to the user.</summary>
    ChecksumOnly,
    Attested,
}

public sealed record DownloadResult(string Path, Provenance Provenance);

public interface IAttestationVerifier
{
    bool CanVerify { get; }

    Task VerifyAsync(string sha256Hex, CancellationToken ct);
}

/// <summary>The documented gap: no audited Sigstore client is wired in, so only the checksum is verified.</summary>
public sealed class ChecksumOnlyAttestationVerifier : IAttestationVerifier
{
    public bool CanVerify => false;

    public Task VerifyAsync(string sha256Hex, CancellationToken ct) =>
        throw new NotSupportedException("no Sigstore client is configured; only the SHA-256 checksum can be verified");
}

public sealed class UpdateDownloader(HttpClient http, IAttestationVerifier verifier, long maxBytes = 1_000_000_000, bool requireAttestation = false)
{
    public async Task<DownloadResult> DownloadAsync(UpdateInfo info, IProgress<(long Bytes, long? Total)>? progress = null, CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(info.Sha256)) throw new InvalidOperationException("release has no SHA-256 digest to verify against");

        if (await IsVerified(info))
            return new DownloadResult(info.DownloadPath, await VerifyProvenance(info.Sha256, ct));

        var part = info.DownloadPath + ".part";
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(info.DownloadPath))!);
        try
        {
            await Fetch(info, part, progress, ct);
            var provenance = await VerifyProvenance(info.Sha256, ct);
            File.Move(part, info.DownloadPath, overwrite: true);
            return new DownloadResult(info.DownloadPath, provenance);
        }
        catch
        {
            File.Delete(part);
            throw;
        }
    }

    private async Task Fetch(UpdateInfo info, string part, IProgress<(long, long?)>? progress, CancellationToken ct)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, info.DownloadUrl ?? throw new InvalidOperationException("release asset has no download URL"));
        request.Headers.UserAgent.ParseAdd("code-chroma-desktop");
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"download failed ({(int)response.StatusCode})");

        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        await using (var body = await response.Content.ReadAsStreamAsync(ct))
        await using (var output = File.Create(part))
        {
            var buffer = new byte[81920];
            long total = 0;
            int read;
            while ((read = await body.ReadAsync(buffer, ct)) > 0)
            {
                total += read;
                if (total > maxBytes) throw new InvalidOperationException("download too large; refusing to write an oversized installer");
                hash.AppendData(buffer, 0, read);
                await output.WriteAsync(buffer.AsMemory(0, read), ct);
                progress?.Report((total, response.Content.Headers.ContentLength));
            }
        }
        if (!string.Equals(Convert.ToHexString(hash.GetHashAndReset()), info.Sha256, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("download failed integrity check");
    }

    private async Task<Provenance> VerifyProvenance(string sha256, CancellationToken ct)
    {
        if (!verifier.CanVerify)
        {
            if (requireAttestation) throw new InvalidOperationException("no attestation verifier is available; refusing to prepare an update without signed provenance");
            return Provenance.ChecksumOnly;
        }
        await verifier.VerifyAsync(sha256, ct);
        return Provenance.Attested;
    }

    private static async Task<bool> IsVerified(UpdateInfo info)
    {
        try
        {
            await using var stream = File.OpenRead(info.DownloadPath);
            return string.Equals(Convert.ToHexString(await SHA256.HashDataAsync(stream)), info.Sha256, StringComparison.OrdinalIgnoreCase);
        }
        catch (IOException)
        {
            return false;
        }
        catch (UnauthorizedAccessException)
        {
            return false;
        }
    }
}
