namespace CodeChroma.Shell.Tests;

public class UpdateServiceTests
{
    private static readonly UpdateInfo Info = new("2.0.0", "app", "tmp", null, null, null);

    private sealed class FakeOps : IUpdateOperations
    {
        public Func<string, Action<string>?, UpdateInfo?> Check = (_, onLatest) => { onLatest?.Invoke("2.0.0"); return Info; };
        public Action? Download = () => { };
        public Action? Writable = () => { };
        public int Checks, Downloads, Installs;

        public Task<UpdateInfo?> CheckAsync(string current, Action<string>? onLatest, CancellationToken ct)
        {
            Checks++;
            return Task.FromResult(Check(current, onLatest));
        }

        public Task DownloadAsync(UpdateInfo info, Action<long, long?> progress, CancellationToken ct)
        {
            Downloads++;
            Download?.Invoke();
            return Task.CompletedTask;
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
}
