namespace CodeChroma.Shell.Tests.Updater;

public class UpdateServiceTests
{
    private static readonly UpdateInfo Info = new("2.0.0", "app", "tmp", null, null, null);

    private sealed class FakeOps : IUpdateOperations
    {
        public Func<string, Action<string>?, UpdateInfo?> Check = (_, onLatest) => { onLatest?.Invoke("2.0.0"); return Info; };
        public Action? Download = () => { };
        public Action? Writable = () => { };
        public Provenance Expected = Provenance.ChecksumOnly;
        public Provenance Downloaded = Provenance.ChecksumOnly;
        public int Checks, Downloads, Installs;

        public Provenance ExpectedProvenance => Expected;

        public Task<UpdateInfo?> CheckAsync(string current, Action<string>? onLatest, CancellationToken ct)
        {
            Checks++;
            return Task.FromResult(Check(current, onLatest));
        }

        public Task<Provenance> DownloadAsync(UpdateInfo info, Action<long, long?> progress, CancellationToken ct)
        {
            Downloads++;
            Download?.Invoke();
            return Task.FromResult(Downloaded);
        }

        public Task<bool> InstallAsync(UpdateInfo info, CancellationToken ct)
        {
            Installs++;
            return Task.FromResult(true);
        }

        public void AssertWritable() => Writable?.Invoke();
    }

    private sealed class MemoryCache(string? initial) : IUpdateCache
    {
        public string? Latest = initial;
        public string? Read() => Latest;
        public void Write(string version) => Latest = version;
    }

    private static (UpdateService, FakeOps, List<UpdatePhase>) Make(string current = "1.0.0", IUpdateCache? cache = null)
    {
        var ops = new FakeOps();
        var phases = new List<UpdatePhase>();
        return (new UpdateService(current, ops, cache ?? new MemoryCache(null), s => phases.Add(s.Phase)), ops, phases);
    }

    [Fact]
    public async Task Up_to_date_retains_installed_and_latest_versions()
    {
        var (service, ops, _) = Make("2.0.0");
        ops.Check = (_, onLatest) => { onLatest?.Invoke("2.0.0"); return null; };

        var state = await service.CheckAsync();

        Assert.Equal((UpdatePhase.UpToDate, "2.0.0", "2.0.0"), (state.Phase, state.CurrentVersion, state.LatestVersion));
    }

    [Fact]
    public async Task Downloads_then_waits_for_explicit_restart()
    {
        var (service, ops, phases) = Make();
        await service.CheckAsync();

        var downloaded = await service.DownloadAsync();
        var relaunch = new List<bool>();
        await service.RestartAsync(relaunch.Add);

        Assert.Equal(UpdatePhase.Ready, downloaded.Phase);
        Assert.Contains(UpdatePhase.Downloading, phases);
        Assert.Equal(1, ops.Installs);
        Assert.Equal([true], relaunch);
    }

    [Theory]
    [InlineData("download", "Download failed (503)", "503")]
    [InlineData("writable", "Reinstall with the per-user installer", "per-user")]
    [InlineData("check", "Network unreachable", "Network unreachable")]
    public async Task Failures_become_an_error_state_with_the_manual_fallback(string stage, string message, string expected)
    {
        var (service, ops, _) = Make();
        if (stage == "check") ops.Check = (_, _) => throw new InvalidOperationException(message);
        if (stage == "download") ops.Download = () => throw new InvalidOperationException(message);
        if (stage == "writable") ops.Writable = () => throw new InvalidOperationException(message);

        var state = stage == "check" ? await service.CheckAsync() : await CheckThenDownload(service);

        Assert.Equal(UpdatePhase.Error, state.Phase);
        Assert.Contains(expected, state.Error);
        Assert.Contains("GitHub Releases", state.Error);
        Assert.Equal(0, ops.Installs);
        if (stage == "writable") Assert.Equal(0, ops.Downloads);
    }

    private static async Task<UpdateState> CheckThenDownload(UpdateService service)
    {
        await service.CheckAsync();
        return await service.DownloadAsync();
    }

    [Fact]
    public async Task Sigstore_trust_root_failures_are_explained()
    {
        var (service, ops, _) = Make();
        ops.Download = () => throw new InvalidOperationException("root was signed by 0/3 keys");

        var state = await CheckThenDownload(service);

        Assert.Equal("Release signature could not be verified (0/3 keys). The release may be unsigned or signed with outdated keys. Update manually from GitHub Releases.", state.Error);
    }

    [Fact]
    public async Task Rate_limit_keeps_the_cached_version_and_suppresses_retries_until_the_reset()
    {
        var now = DateTimeOffset.FromUnixTimeSeconds(1_000_000);
        var ops = new FakeOps();
        ops.Check = (_, _) => throw new GitHubRateLimitException("Rate limit. Resets in 1 minute.", now.AddMinutes(1));
        var service = new UpdateService("1.0.0", ops, new MemoryCache("1.8.0"), _ => { }, () => now);

        var first = await service.CheckAsync();
        await service.CheckAsync();

        Assert.Equal((UpdatePhase.Error, "1.8.0"), (first.Phase, first.LatestVersion));
        Assert.Equal(now.AddMinutes(1), first.RetryAfter);
        Assert.Equal(1, ops.Checks);
    }

    [Fact]
    public async Task Latest_version_is_loaded_from_and_persisted_to_the_cache()
    {
        var cache = new MemoryCache("v2.0.0");
        var ops = new FakeOps { Check = (_, onLatest) => { onLatest?.Invoke("v2.1.0"); return null; } };
        var service = new UpdateService("2.1.0", ops, cache, _ => { });

        var before = service.State.LatestVersion;
        var after = (await service.CheckAsync()).LatestVersion;

        Assert.Equal(("v2.0.0", "v2.1.0", "v2.1.0"), (before, after, cache.Latest));
    }

    [Fact]
    public async Task Restart_before_download_is_refused()
    {
        var (service, ops, _) = Make();
        await service.CheckAsync();

        var state = await service.RestartAsync(_ => { });

        Assert.Equal(UpdatePhase.Error, state.Phase);
        Assert.Equal(0, ops.Installs);
    }

    [Theory]
    [InlineData(Provenance.ChecksumOnly, true)]
    [InlineData(Provenance.Attested, false)]
    public async Task A_checksum_only_update_is_flagged_when_offered_and_again_when_ready(Provenance provenance, bool flagged)
    {
        var (service, ops, _) = Make();
        ops.Expected = provenance;
        ops.Downloaded = provenance;

        var offered = await service.CheckAsync();
        var ready = await service.DownloadAsync();

        var expectedNotice = flagged ? UpdateConstants.ChecksumOnlyNotice : null;
        Assert.Equal(expectedNotice, offered.VerificationNotice);
        Assert.Equal((provenance, expectedNotice), (ready.Provenance, ready.VerificationNotice));
    }

    [Fact]
    public void The_downgrade_notice_names_what_is_and_is_not_checked()
    {
        var notice = UpdateConstants.ChecksumOnlyNotice;

        Assert.Contains("SHA-256", notice);
        Assert.Contains("not signed or attested", notice);
        Assert.Contains("compromised release", notice);
    }

    [Fact]
    public async Task A_rollback_from_the_previous_launch_is_surfaced_until_dismissed()
    {
        var acknowledged = 0;
        var outcome = new InstallOutcome("rolled-back", "2.0.0", "the new version exited during startup; the previous version was restored");
        var service = new UpdateService("1.0.0", new FakeOps(), new MemoryCache(null), _ => { }, readOutcome: () => outcome, acknowledgeOutcome: () => acknowledged++);

        var before = service.State.LastInstall;
        service.DismissLastInstall();

        Assert.True(before!.RolledBack);
        Assert.Null(service.State.LastInstall);
        Assert.Equal(1, acknowledged);
    }

    [Fact]
    public async Task Electron_only_release_is_reported_as_a_manual_download()
    {
        var (service, ops, _) = Make();
        ops.Check = (_, onLatest) => { onLatest?.Invoke("2.0.0"); return new UpdateInfo("2.0.0", "CodeChroma-Setup.exe", "tmp", null, null, null); };

        var state = await service.CheckAsync();

        Assert.Equal(UpdatePhase.Error, state.Phase);
        Assert.Contains("manually", state.Error);
    }

    [Theory]
    [InlineData("https://github.com/gutzerk/code_chroma/releases/download/v1/../../../evil/x.zip", false)]
    [InlineData("https://github.com/gutzerk/code_chroma/releases/download/v1/%2e%2e/x.zip", false)]
    [InlineData("https://github.com/gutzerk/code_chroma/releases/download/v1/app.zip", true)]
    public void Trusted_download_url_rejects_dot_segments(string url, bool expected)
    {
        var trusted = UpdateConstants.IsTrustedDownloadUrl(url);

        Assert.Equal(expected, trusted);
    }
}
