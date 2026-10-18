using System.Text.Json.Nodes;
using CodeChroma.Bridge.Engine;
using CodeChroma.Bridge.Routes;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Tests.Workspaces;

public class WorkspaceRegistryTests : IDisposable
{
    private readonly string _dir = Directory.CreateTempSubdirectory("cc-reg-").FullName;
    private readonly ManualTime _time = new();
    private readonly List<string> _created = [];

    public void Dispose() => Directory.Delete(_dir, recursive: true);

    [Fact]
    public void Trigger_after_dispose_does_not_throw()
    {
        var debouncer = new Debouncer(TimeSpan.FromMilliseconds(10), () => { });
        debouncer.Dispose();

        var error = Record.Exception(debouncer.Trigger);

        Assert.Null(error);
    }

    [Fact]
    public async Task A_burst_of_triggers_fires_without_overlapping_callbacks()
    {
        var active = 0;
        var overlapped = false;
        var fired = 0;
        using var debouncer = new Debouncer(TimeSpan.FromMilliseconds(5), () =>
        {
            if (Interlocked.Increment(ref active) > 1) overlapped = true;
            Thread.Sleep(40);
            Interlocked.Increment(ref fired);
            Interlocked.Decrement(ref active);
        });

        for (var i = 0; i < 20; i++) { debouncer.Trigger(); await Task.Delay(10); }
        await Task.Delay(300);

        Assert.False(overlapped);
        Assert.True(fired >= 1);
    }

    [Fact]
    public void SourceText_rejects_parent_escapes()
    {
        var inside = Path.Combine(_dir, "a.txt");
        var outside = Path.Combine(_dir, "..", "other.txt");

        Assert.True(SourceText.IsWithin(_dir, inside));
        Assert.False(SourceText.IsWithin(_dir, outside));
    }

    [Fact]
    public void SourceText_rejects_a_symlink_that_escapes_the_repo()
    {
        var elsewhere = Directory.CreateTempSubdirectory("cc-out-").FullName;
        File.WriteAllText(Path.Combine(elsewhere, "secret.txt"), "x");
        var link = Path.Combine(_dir, "link");
        try { Directory.CreateSymbolicLink(link, elsewhere); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { Directory.Delete(elsewhere, true); return; }

        var escaped = SourceText.IsWithin(_dir, Path.Combine(link, "secret.txt"));

        Directory.Delete(link);
        Directory.Delete(elsewhere, true);
        Assert.False(escaped);
    }

    [Theory]
    [InlineData("LMP-65", true)]
    [InlineData("..", false)]
    [InlineData("a/b", false)]
    [InlineData("a\\b", false)]
    [InlineData(".hidden", false)]
    public void Epic_ids_must_be_one_safe_path_segment(string id, bool valid)
    {
        Assert.Equal(valid, EpicsRoutes.ValidEpicId(id));
    }

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

    [Fact]
    public async Task A_slow_bring_up_does_not_block_other_registry_calls()
    {
        var entered = new ManualResetEventSlim();
        var release = new ManualResetEventSlim();
        var registry = new WorkspaceRegistry(_dir, new BlockingFactory(entered, release), (_, _) => { }, _time, startWatchers: false);
        registry.Register("slow", _dir);

        var slow = Task.Run(() => registry.Get("slow"));
        Assert.True(entered.Wait(TimeSpan.FromSeconds(5)));
        var others = Task.Run(() => (registry.IsRegistered("slow"), registry.IsReadOnly("slow"), registry.Get("main")));
        var finished = await Task.WhenAny(others, Task.Delay(TimeSpan.FromSeconds(3))) == others;
        release.Set();
        await slow;

        Assert.True(finished);
        Assert.Same(registry.Main, (await others).Item3);
    }

    [Fact]
    public async Task Concurrent_gets_of_one_id_bring_it_up_once()
    {
        var registry = NewRegistry();
        registry.Register("agent", _dir);

        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Task.Run(() => registry.Get("agent"))));

        Assert.All(results, r => Assert.Same(results[0], r));
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

    private sealed class BlockingFactory(ManualResetEventSlim entered, ManualResetEventSlim release) : IEngineFactory
    {
        private int _calls;

        public IGraphEngine Create(string root)
        {
            if (Interlocked.Increment(ref _calls) > 1)
            {
                entered.Set();
                release.Wait(TimeSpan.FromSeconds(10));
            }
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
        using var debouncer = new Debouncer(TimeSpan.FromMilliseconds(400), () => Interlocked.Increment(ref fired));

        for (var i = 0; i < 5; i++) debouncer.Trigger();
        for (var waited = 0; Volatile.Read(ref fired) == 0 && waited < 100; waited++) await Task.Delay(100);
        await Task.Delay(800);

        Assert.Equal(1, Volatile.Read(ref fired));
    }
}
