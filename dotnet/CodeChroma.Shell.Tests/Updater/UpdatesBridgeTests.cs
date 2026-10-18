using System.Text.Json;

namespace CodeChroma.Shell.Tests.Updater;

public class UpdatesBridgeTests
{
    private sealed class StubOps : IUpdateOperations
    {
        public Provenance ExpectedProvenance => Provenance.ChecksumOnly;

        public Task<UpdateInfo?> CheckAsync(string currentVersion, Action<string>? onLatest, CancellationToken ct)
        {
            onLatest?.Invoke("2.0.0");
            return Task.FromResult<UpdateInfo?>(new UpdateInfo("2.0.0", "app", "tmp", null, null, "notes"));
        }

        public Task<Provenance> DownloadAsync(UpdateInfo info, Action<long, long?> progress, CancellationToken ct) => Task.FromResult(Provenance.ChecksumOnly);

        public Task<bool> InstallAsync(UpdateInfo info, CancellationToken ct) => Task.FromResult(true);

        public void AssertWritable()
        {
        }
    }

    private sealed class MemoryCache : IUpdateCache
    {
        public string? Read() => null;

        public void Write(string version)
        {
        }
    }

    private static (UpdatesBridge Bridge, Func<UpdateSettings> Settings, List<string> Pushed, List<bool> Restarts) Create()
    {
        var settings = new UpdateSettings();
        var pushed = new List<string>();
        var restarts = new List<bool>();
        UpdatesBridge? bridge = null;
        var service = new UpdateService("1.0.0", new StubOps(), new MemoryCache(), _ => bridge?.Push());
        bridge = new UpdatesBridge(service, () => settings, s => settings = s, restarts.Add, pushed.Add);
        return (bridge, () => settings, pushed, restarts);
    }

    private static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement;

    [Theory]
    [InlineData(UpdatePhase.Idle, "idle")]
    [InlineData(UpdatePhase.UpToDate, "up-to-date")]
    [InlineData(UpdatePhase.Available, "available")]
    [InlineData(UpdatePhase.Installing, "installing")]
    public void Phase_names_match_what_the_settings_panel_expects(UpdatePhase phase, string expected)
    {
        var json = UpdatesBridge.ToJson(new UpdateState("1.0.0", Phase: phase), new UpdateSettings());

        Assert.Equal(expected, Parse(json).GetProperty("phase").GetString());
    }

    [Fact]
    public void Retry_after_is_epoch_milliseconds_and_settings_are_merged_in()
    {
        var retry = new DateTimeOffset(2026, 1, 1, 0, 0, 0, TimeSpan.Zero);

        var json = Parse(UpdatesBridge.ToJson(new UpdateState("1.0.0", RetryAfter: retry), new UpdateSettings("1.5.0", true)));

        Assert.Equal(retry.ToUnixTimeMilliseconds(), json.GetProperty("retryAfter").GetInt64());
        Assert.Equal("1.5.0", json.GetProperty("skippedVersion").GetString());
        Assert.True(json.GetProperty("autoDownload").GetBoolean());
    }

    [Fact]
    public async Task Check_returns_the_offered_update_with_the_checksum_only_notice()
    {
        var (bridge, _, _, _) = Create();

        var json = Parse(await bridge.InvokeAsync("check", null));

        Assert.Equal("available", json.GetProperty("phase").GetString());
        Assert.Equal(UpdateConstants.ChecksumOnlyNotice, json.GetProperty("verificationNotice").GetString());
    }

    [Fact]
    public async Task Every_state_change_is_pushed_to_the_page()
    {
        var (bridge, _, pushed, _) = Create();

        await bridge.InvokeAsync("check", null);

        Assert.NotEmpty(pushed);
        Assert.Equal("available", Parse(pushed[^1]).GetProperty("phase").GetString());
    }

    [Fact]
    public async Task Skip_persists_the_version()
    {
        var (bridge, settings, _, _) = Create();

        var json = Parse(await bridge.InvokeAsync("skip", "2.0.0"));

        Assert.Equal("2.0.0", settings().SkippedVersion);
        Assert.Equal("2.0.0", json.GetProperty("skippedVersion").GetString());
    }

    [Theory]
    [InlineData("true", true)]
    [InlineData("false", false)]
    public async Task Auto_download_persists_the_choice(string arg, bool expected)
    {
        var (bridge, settings, _, _) = Create();

        await bridge.InvokeAsync("auto-download", arg);

        Assert.Equal(expected, settings().AutoDownload);
    }

    [Fact]
    public async Task Restart_quits_the_app_only_after_the_update_is_downloaded()
    {
        var (bridge, _, _, restarts) = Create();
        await bridge.InvokeAsync("check", null);
        await bridge.InvokeAsync("download", null);

        await bridge.InvokeAsync("restart", null);

        Assert.Equal([true], restarts);
    }

    [Fact]
    public async Task An_unknown_method_is_rejected()
    {
        var (bridge, _, _, _) = Create();

        await Assert.ThrowsAsync<ArgumentException>(() => bridge.InvokeAsync("format-disk", null));
    }
}
