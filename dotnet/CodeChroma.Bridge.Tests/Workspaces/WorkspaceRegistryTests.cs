using System.Text.Json.Nodes;
using CodeChroma.Bridge.Engine;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Tests.Workspaces;

public class WorkspaceRegistryTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("cc-reg-").FullName;
    private readonly ManualTime _time = new();
    private readonly List<string> _created = [];

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    private WorkspaceRegistry NewRegistry() => new(
        _dir, new CountingFactory(_created), (_, _) => { }, _time, startWatchers: false);

    [Fact]
    public void The_limits_match_the_python_bridge()
    {
        Assert.Equal(600, BridgeLimits.IdleUnloadSeconds);
        Assert.Equal(1000, BridgeLimits.RepoDebounceMs);
        Assert.Equal(500, BridgeLimits.WatcherDebounceMs);
        Assert.Equal(10, BridgeLimits.GitShortTimeoutSeconds);
        Assert.Equal(120, BridgeLimits.GitLongTimeoutSeconds);
        Assert.Equal(5, BridgeLimits.SocketSendTimeoutSeconds);
    }

    [Fact]
    public void An_unregistered_id_resolves_to_main()
    {
        var registry = NewRegistry();

        Assert.Same(registry.Main, registry.Get("nobody"));
    }

    [Fact]
    public void A_registered_workspace_comes_up_lazily_and_once()
    {
        var registry = NewRegistry();
        registry.Register("agent", _dir);

        var first = registry.Get("agent");
        var second = registry.Get("agent");

        Assert.Same(first, second);
        Assert.Equal(2, _created.Count);
    }

    [Theory]
    [InlineData(599, false)]
    [InlineData(600, true)]
    public void An_idle_workspace_unloads_at_the_threshold(int idleSeconds, bool unloaded)
    {
        var registry = NewRegistry();
        registry.Register("agent", _dir);
        registry.Get("agent");

        _time.Advance(TimeSpan.FromSeconds(idleSeconds));
        var dropped = registry.UnloadIdle();

        Assert.Equal(unloaded, dropped.Contains("agent"));
        Assert.Equal(!unloaded, registry.IsLive("agent"));
    }

    [Fact]
    public void Main_is_never_unloaded_and_a_dropped_workspace_reanalyzes_on_next_access()
    {
        var registry = NewRegistry();
        registry.Register("agent", _dir);
        registry.Get("agent");
        _time.Advance(TimeSpan.FromHours(1));

        var dropped = registry.UnloadIdle();
        registry.Get("agent");

        Assert.Equal(["agent"], dropped);
        Assert.True(registry.IsLive("main"));
        Assert.Equal(3, _created.Count);
    }

    [Fact]
    public void A_status_for_an_unknown_id_is_an_error_and_main_is_ready()
    {
        var registry = NewRegistry();

        Assert.Equal("error", registry.State("nobody").State);
        Assert.Equal("unknown workspace", registry.State("nobody").Error);
        Assert.Equal("ready", registry.State("main").State);
    }

    private sealed class CountingFactory(List<string> created) : IEngineFactory
    {
        public IGraphEngine Create(string root)
        {
            created.Add(root);
            return new JsonSnapshotEngine(Path.Combine(Contract.ContractCases.FixtureDir, "engine_snapshot.sample_repo.json"));
        }
    }

    private sealed class ManualTime : TimeProvider
    {
        private long _ticks;
        public override long TimestampFrequency => TimeSpan.TicksPerSecond;
        public override long GetTimestamp() => _ticks;
        public void Advance(TimeSpan by) => _ticks += by.Ticks;
    }
}

public class DebouncerTests
{
    [Fact]
    public async Task A_burst_of_triggers_fires_once_after_the_quiet_window()
    {
        var fired = 0;
        using var debouncer = new Debouncer(TimeSpan.FromMilliseconds(150), () => Interlocked.Increment(ref fired));

        for (var i = 0; i < 5; i++)
        {
            debouncer.Trigger();
            await Task.Delay(40);
        }
        Assert.Equal(0, fired);
        await Task.Delay(400);

        Assert.Equal(1, fired);
    }
}
