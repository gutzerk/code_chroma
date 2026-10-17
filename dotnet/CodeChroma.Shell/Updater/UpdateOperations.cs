using System.Text.Json;

namespace CodeChroma.Shell;

/// <summary>The real <see cref="IUpdateOperations"/>: GitHub check, checksum-verified download, per-user guard and the platform swap.</summary>
public sealed class UpdateOperations(
    UpdateChecker checker,
    UpdateDownloader downloader,
    PlatformInstaller installer,
    InstallLocation location,
    ShellPlatform platform,
    Provenance expectedProvenance = Provenance.ChecksumOnly) : IUpdateOperations
{
    public Provenance ExpectedProvenance => expectedProvenance;

    public Task<UpdateInfo?> CheckAsync(string currentVersion, Action<string>? onLatest, CancellationToken ct) =>
        checker.CheckAsync(currentVersion, platform, onLatest, ct);

    public async Task<Provenance> DownloadAsync(UpdateInfo info, Action<long, long?> progress, CancellationToken ct) =>
        (await downloader.DownloadAsync(info, new SyncProgress(progress), ct)).Provenance;

    public Task<bool> InstallAsync(UpdateInfo info, CancellationToken ct) => installer.InstallAsync(info, ct);

    public void AssertWritable() => location.AssertUserInstallation();

    private sealed class SyncProgress(Action<long, long?> report) : IProgress<(long Bytes, long? Total)>
    {
        public void Report((long Bytes, long? Total) value) => report(value.Bytes, value.Total);
    }
}

/// <summary>User choices about updates, stored as update-settings.json with the same shape the Electron app wrote.</summary>
public sealed record UpdateSettings(string? SkippedVersion = null, bool AutoDownload = false);

public static class UpdateSettingsStore
{
    public static string PathIn(string userDataDir) => Path.Combine(userDataDir, "update-settings.json");

    public static UpdateSettings Read(string path)
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return new UpdateSettings();
            var skipped = root.TryGetProperty("skippedVersion", out var s) && s.ValueKind == JsonValueKind.String ? s.GetString() : null;
            var auto = root.TryGetProperty("autoDownload", out var a) && a.ValueKind == JsonValueKind.True;
            return new UpdateSettings(skipped is not null && SemVer.TryParse(skipped, out _) ? skipped : null, auto);
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return new UpdateSettings();
        }
    }

    public static void Write(string path, UpdateSettings settings)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var shaped = settings.SkippedVersion is null
            ? (object)new { autoDownload = settings.AutoDownload }
            : new { skippedVersion = settings.SkippedVersion, autoDownload = settings.AutoDownload };
        File.WriteAllText(path, JsonSerializer.Serialize(shaped));
    }
}

public enum CheckTrigger { Startup, Periodic, Focus, Manual }

/// <summary>Decides when to check (every 6 hours, on focus at most hourly) and whether a result may interrupt the user.</summary>
public sealed class UpdateScheduler(Func<DateTimeOffset> clock, bool packaged = true)
{
    private DateTimeOffset? lastCheck;
    private string? notifiedVersion;

    public bool ShouldCheck(CheckTrigger trigger)
    {
        if (trigger == CheckTrigger.Manual) return true;
        if (!packaged) return false;
        var now = clock();
        return trigger switch
        {
            CheckTrigger.Startup => true,
            CheckTrigger.Periodic => lastCheck is null || now - lastCheck >= UpdateConstants.PeriodicCheck,
            _ => lastCheck is null || now - lastCheck >= UpdateConstants.FocusMinGap,
        };
    }

    public void RecordCheck() => lastCheck = clock();

    /// <summary>A background result notifies once per version and never for a skipped one; a manual check always shows it.</summary>
    public bool ShouldNotify(string version, UpdateSettings settings, CheckTrigger trigger)
    {
        if (trigger == CheckTrigger.Manual) return true;
        if (settings.SkippedVersion is { } skipped && SemVer.TryParse(skipped, out _) && SemVer.CompareTags(skipped, version) == 0) return false;
        if (notifiedVersion == version) return false;
        notifiedVersion = version;
        return true;
    }
}

/// <summary>Removes installer downloads an interrupted update left in the temp directory.</summary>
public static class StaleDownloads
{
    private static readonly string[] Patterns =
    [
        "CodeChroma-*.zip", "CodeChroma-*.zip.part", "CodeChroma-*.AppImage", "CodeChroma-*.AppImage.part",
        "CodeChroma-*.exe", "CodeChroma-*.exe.part", "CodeChroma-*.dmg", "CodeChroma-*.dmg.part",
    ];

    public static int Cleanup(string tempDir)
    {
        var removed = 0;
        foreach (var file in Patterns.SelectMany(p => Directory.EnumerateFiles(tempDir, p)).ToList())
        {
            try
            {
                File.Delete(file);
                removed++;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        }
        return removed;
    }
}
