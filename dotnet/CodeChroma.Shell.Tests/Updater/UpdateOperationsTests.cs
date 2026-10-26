using System.Net;
using System.Security.Cryptography;
using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests.Updater;

public class UpdateOperationsTests
{
    private static readonly DateTimeOffset Noon = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task A_full_check_download_and_install_flags_the_checksum_only_downgrade_and_hands_off_to_the_helper()
    {
        using var scenario = new InstallScenario(ShellOs.Windows);
        var zip = scenario.Package();
        var bytes = await File.ReadAllBytesAsync(zip.DownloadPath);
        File.Delete(zip.DownloadPath);
        var sha = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        var url = $"https://github.com/gutzerk/code_chroma/releases/download/v2.0.0/{scenario.AssetName}";
        var client = StubHandler.Client(request => request.RequestUri!.Host == "api.github.com"
            ? StubHandler.Json(HttpStatusCode.OK, $$"""{"tag_name":"v2.0.0","body":"notes","assets":[{"name":"{{scenario.AssetName}}","browser_download_url":"{{url}}","digest":"sha256:{{sha}}"}]}""")
            : new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) });
        var launcher = new RecordingLauncher();
        var ops = new UpdateOperations(
            new UpdateChecker(client, tempDir: scenario.Temp.Dir("dl")), new UpdateDownloader(client, new ChecksumOnlyAttestationVerifier()),
            scenario.Installer(launcher), scenario.Location, scenario.Platform);
        var states = new List<UpdateState>();
        var service = new UpdateService("1.0.0", ops, new FileUpdateCache(FileUpdateCache.PathIn(scenario.UserData)), states.Add, () => Noon);

        var offered = await service.CheckAsync();
        var ready = await service.DownloadAsync();
        var quit = new List<bool>();
        await service.RestartAsync(quit.Add);

        Assert.Equal((UpdatePhase.Available, UpdateConstants.ChecksumOnlyNotice), (offered.Phase, offered.VerificationNotice));
        Assert.Equal((UpdatePhase.Ready, Provenance.ChecksumOnly, UpdateConstants.ChecksumOnlyNotice), (ready.Phase, ready.Provenance, ready.VerificationNotice));
        Assert.Equal([true], quit);
        Assert.Single(launcher.Launches);
        Assert.Equal("new exe", await File.ReadAllTextAsync(Path.Combine($"{scenario.Target}.update-4242", InstallScenario.WindowsExe)));
    }

    [Fact]
    public async Task A_tampered_download_never_reaches_the_installer()
    {
        using var scenario = new InstallScenario(ShellOs.Windows);
        var url = $"https://github.com/gutzerk/code_chroma/releases/download/v2.0.0/{scenario.AssetName}";
        var client = StubHandler.Client(request => request.RequestUri!.Host == "api.github.com"
            ? StubHandler.Json(HttpStatusCode.OK, $$"""{"tag_name":"v2.0.0","assets":[{"name":"{{scenario.AssetName}}","browser_download_url":"{{url}}","digest":"sha256:{{new string('b', 64)}}"}]}""")
            : new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent("tampered"u8.ToArray()) });
        var launcher = new RecordingLauncher();
        var ops = new UpdateOperations(
            new UpdateChecker(client, tempDir: scenario.Temp.Dir("dl")), new UpdateDownloader(client, new ChecksumOnlyAttestationVerifier()),
            scenario.Installer(launcher), scenario.Location, scenario.Platform);
        var service = new UpdateService("1.0.0", ops, new FileUpdateCache(FileUpdateCache.PathIn(scenario.UserData)), _ => { });

        await service.CheckAsync();
        var state = await service.DownloadAsync();

        Assert.Equal(UpdatePhase.Error, state.Phase);
        Assert.Contains("integrity", state.Error);
        Assert.Empty(launcher.Launches);
    }

    [Fact]
    public void A_system_wide_install_is_not_writable()
    {
        var location = new InstallLocation(ShellOs.MacOs, "/Applications/CodeChroma.app/Contents/MacOS/x", "/h", null, null);
        var ops = new UpdateOperations(null!, null!, null!, location, new(ShellOs.MacOs, ShellArch.Arm64));

        Assert.Throws<UnauthorizedAccessException>(ops.AssertWritable);
    }

    [Fact]
    public void Settings_round_trip_in_the_settings_file_format_and_ignore_bad_values()
    {
        using var temp = new TempDir();
        var path = UpdateSettingsStore.PathIn(temp.Path);

        UpdateSettingsStore.Write(path, new UpdateSettings("v1.2.3", true));
        var stored = File.ReadAllText(path);
        File.WriteAllText(path, """{"skippedVersion":"nonsense","autoDownload":"yes"}""");

        Assert.Equal("""{"skippedVersion":"v1.2.3","autoDownload":true}""", stored);
        Assert.Equal(new UpdateSettings(), UpdateSettingsStore.Read(path));
        Assert.Equal(new UpdateSettings(), UpdateSettingsStore.Read(temp.Sub("missing.json")));
    }

    [Theory]
    [InlineData(CheckTrigger.Startup, 0, true)]
    [InlineData(CheckTrigger.Periodic, 5 * 60, false)]
    [InlineData(CheckTrigger.Periodic, 6 * 60, true)]
    [InlineData(CheckTrigger.Focus, 59, false)]
    [InlineData(CheckTrigger.Focus, 60, true)]
    [InlineData(CheckTrigger.Manual, 0, true)]
    public void Checks_run_every_six_hours_and_on_focus_at_most_hourly(CheckTrigger trigger, int minutesAfterLast, bool expected)
    {
        var now = Noon;
        var scheduler = new UpdateScheduler(() => now);
        scheduler.RecordCheck();
        now = Noon.AddMinutes(minutesAfterLast);

        Assert.Equal(expected, scheduler.ShouldCheck(trigger));
    }

    [Fact]
    public void An_unpackaged_dev_run_never_checks_in_the_background_but_a_manual_check_works()
    {
        var scheduler = new UpdateScheduler(() => Noon, packaged: false);

        Assert.False(scheduler.ShouldCheck(CheckTrigger.Startup));
        Assert.True(scheduler.ShouldCheck(CheckTrigger.Manual));
    }

    [Fact]
    public void A_background_result_notifies_once_per_version_and_never_for_a_skipped_one()
    {
        var scheduler = new UpdateScheduler(() => Noon);
        var skipping = new UpdateSettings("v2.0.0");

        var results = new[]
        {
            scheduler.ShouldNotify("v2.0.0", skipping, CheckTrigger.Startup),
            scheduler.ShouldNotify("v2.0.0", skipping, CheckTrigger.Manual),
            scheduler.ShouldNotify("v2.1.0", skipping, CheckTrigger.Startup),
            scheduler.ShouldNotify("v2.1.0", skipping, CheckTrigger.Startup),
        };

        Assert.Equal([false, true, true, false], results);
    }

    [Theory]
    [InlineData(CheckTrigger.Periodic)]
    [InlineData(CheckTrigger.Focus)]
    public void A_periodic_or_focus_result_never_interrupts_the_running_app(CheckTrigger trigger)
    {
        var scheduler = new UpdateScheduler(() => Noon);

        Assert.False(scheduler.ShouldNotify("v2.1.0", new UpdateSettings(null), trigger));
    }
}
