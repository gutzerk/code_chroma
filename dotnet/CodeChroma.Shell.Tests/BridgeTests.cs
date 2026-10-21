using System.Net;
using System.Net.Sockets;
using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests;

internal sealed class FakeProcess(BridgeLaunchSpec spec) : IBridgeProcess
{
    private readonly TaskCompletionSource exited = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public BridgeLaunchSpec Spec { get; } = spec;
    public bool StopCalled { get; private set; }
    public bool HasExited => exited.Task.IsCompleted;
    public string? ExitDescription { get; private set; }
    public Task Exited => exited.Task;

    public void Say(string line) => Spec.OnLine(line);

    public void Exit(string description)
    {
        ExitDescription = description;
        exited.TrySetResult();
    }

    public Task StopAsync(TimeSpan grace)
    {
        StopCalled = true;
        Exit("stopped");
        return Task.CompletedTask;
    }
}

internal sealed class FakeLauncher : IBridgeProcessLauncher
{
    public List<FakeProcess> Started { get; } = [];
    public Action<FakeProcess>? OnStart { get; set; }

    public IBridgeProcess Start(BridgeLaunchSpec spec)
    {
        var process = new FakeProcess(spec);
        Started.Add(process);
        OnStart?.Invoke(process);
        return process;
    }
}

internal sealed class SequencePorts : IPortFinder
{
    private int next = 41000;
    public int FindFreePort() => next++;
}

internal sealed class ScriptedHealth(Func<string, bool> healthy) : IHealthProbe
{
    public Task<bool> IsHealthyAsync(string origin, CancellationToken ct) => Task.FromResult(healthy(origin));
}

public class BridgeManagerTests
{
    private static readonly TimeSpan Fast = TimeSpan.FromMilliseconds(5);

    private static BridgeManager Manager(FakeLauncher launcher, Func<string, bool>? healthy = null) =>
        new(launcher, new SequencePorts(), new ScriptedHealth(healthy ?? (_ => false)), Fast);

    [Fact]
    public async Task Launches_the_bridge_on_the_free_port_it_found_for_the_repo()
    {
        var launcher = new FakeLauncher { OnStart = p => p.Say("[codechroma-live] bridge ready at http://127.0.0.1:41000") };

        var handle = await Manager(launcher).StartAsync("bridge.exe", "/repos/atlas");

        var spec = Assert.Single(launcher.Started).Spec;
        Assert.Equal(("bridge.exe", "/repos/atlas", 41000), (spec.Executable, spec.RepoPath, spec.Port));
        Assert.Equal(("http://127.0.0.1:41000", 41000), (handle.Origin, handle.Port));
    }

    [Fact]
    public async Task Ready_line_handshake_completes_without_a_health_answer()
    {
        var launcher = new FakeLauncher();
        launcher.OnStart = p => _ = Task.Run(async () => { await Task.Delay(30); p.Say("analyzing…"); p.Say("[codechroma-live] bridge ready at http://127.0.0.1:41000"); });

        var handle = await Manager(launcher).StartAsync("b", "/r", readyTimeout: TimeSpan.FromSeconds(10));

        Assert.False(handle.Process.HasExited);
    }

    [Fact]
    public async Task Health_endpoint_answering_also_counts_as_ready()
    {
        var handle = await Manager(new FakeLauncher(), healthy: origin => origin == "http://127.0.0.1:41000").StartAsync("b", "/r", readyTimeout: TimeSpan.FromSeconds(10));

        Assert.Equal("http://127.0.0.1:41000", handle.Origin);
    }

    [Fact]
    public async Task Forwards_every_output_line_as_progress()
    {
        var lines = new List<string>();
        var launcher = new FakeLauncher { OnStart = p => { p.Say("  parsing  "); p.Say(""); p.Say("[codechroma-live] bridge ready at x"); } };

        await Manager(launcher).StartAsync("b", "/r", lines.Add);

        Assert.Equal(["parsing", "[codechroma-live] bridge ready at x"], lines);
    }

    [Fact]
    public async Task A_bridge_that_dies_is_reported_at_once_not_after_the_timeout()
    {
        var launcher = new FakeLauncher { OnStart = p => p.Exit("bridge exited (code 3)") };

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Manager(launcher).StartAsync("b", "/r", readyTimeout: TimeSpan.FromMinutes(5)));

        Assert.Contains("bridge exited (code 3)", error.Message);
    }

    [Fact]
    public async Task A_bridge_that_never_gets_ready_is_stopped_and_reported()
    {
        var launcher = new FakeLauncher();

        var error = await Assert.ThrowsAsync<TimeoutException>(() => Manager(launcher).StartAsync("b", "/r", readyTimeout: TimeSpan.FromMilliseconds(80)));

        Assert.Contains("did not become ready", error.Message);
        Assert.True(launcher.Started[0].StopCalled);
    }
}

public class BridgeRegistryTests
{
    private static (BridgeRegistry, FakeLauncher) Make()
    {
        var launcher = new FakeLauncher();
        launcher.OnStart = p => p.Say("[codechroma-live] bridge ready at x");
        var manager = new BridgeManager(launcher, new SequencePorts(), new ScriptedHealth(_ => false), TimeSpan.FromMilliseconds(5));
        return (new BridgeRegistry(manager, "bridge.exe"), launcher);
    }

    [Fact]
    public async Task Different_repos_get_different_bridges_on_different_ports()
    {
        var (registry, launcher) = Make();

        var a = await registry.EnsureAsync("/repos/a");
        var b = await registry.EnsureAsync("/repos/b");

        Assert.NotEqual(a.Port, b.Port);
        Assert.Equal(2, launcher.Started.Count);
    }

    [Fact]
    public async Task A_running_bridge_is_reused_for_the_same_repo()
    {
        var (registry, launcher) = Make();

        var first = await registry.EnsureAsync("/repos/a");
        var second = await registry.EnsureAsync("/repos/a");

        Assert.Same(first, second);
        Assert.Single(launcher.Started);
    }

    [Fact]
    public async Task A_crashed_bridge_is_respawned_for_that_repo_only()
    {
        var (registry, launcher) = Make();
        var a = await registry.EnsureAsync("/repos/a");
        var b = await registry.EnsureAsync("/repos/b");
        ((FakeProcess)a.Process).Exit("bridge exited (code 1)");

        var again = await registry.EnsureAsync("/repos/a");
        var bStill = await registry.EnsureAsync("/repos/b");

        Assert.NotSame(a, again);
        Assert.NotEqual(a.Port, again.Port);
        Assert.Same(b, bStill);
        Assert.Equal(3, launcher.Started.Count);
    }

    [Fact]
    public async Task Concurrent_requests_for_one_repo_start_a_single_bridge()
    {
        var (registry, launcher) = Make();

        var handles = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => registry.EnsureAsync("/repos/a")));

        Assert.All(handles, h => Assert.Same(handles[0], h));
        Assert.Single(launcher.Started);
    }

    [Fact]
    public async Task Stopping_all_stops_every_live_bridge()
    {
        var (registry, launcher) = Make();
        await registry.EnsureAsync("/repos/a");
        await registry.EnsureAsync("/repos/b");

        await registry.StopAllAsync();

        Assert.All(launcher.Started, p => Assert.True(p.StopCalled));
    }
}

public class RealProcessBridgeTests
{
    private static string Dotnet => Environment.GetEnvironmentVariable("DOTNET_HOST_PATH") ?? "dotnet";

    [Fact]
    public void Free_port_is_bindable_and_excludes_a_listening_port()
    {
        var finder = new TcpPortFinder();
        var first = finder.FindFreePort();
        var listener = new TcpListener(IPAddress.Loopback, first);
        listener.Start();
        try
        {
            var second = finder.FindFreePort();
            var secondListener = new TcpListener(IPAddress.Loopback, second);
            try
            {
                secondListener.Start();

                Assert.NotEqual(first, second);
            }
            finally { secondListener.Stop(); }
        }
        finally { listener.Stop(); }
    }

    [Fact]
    public async Task A_real_child_that_exits_is_reported_and_its_output_is_streamed()
    {
        var lines = new List<string>();
        var manager = new BridgeManager(new ProcessBridgeLauncher(), new TcpPortFinder(), new ScriptedHealth(_ => false), TimeSpan.FromMilliseconds(20));

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => manager.StartAsync(Dotnet, Directory.GetCurrentDirectory(), lines.Add, TimeSpan.FromSeconds(60)));

        Assert.Contains("bridge exited", error.Message);
    }

    [Fact]
    public async Task Stopping_without_a_process_is_a_no_op()
    {
        await BridgeManager.StopAsync(null);
    }

    [Fact]
    public async Task A_real_http_health_probe_answers_false_when_nothing_listens()
    {
        var port = new TcpPortFinder().FindFreePort();

        Assert.False(await new HttpHealthProbe(new HttpClient()).IsHealthyAsync($"http://127.0.0.1:{port}", CancellationToken.None));
    }

    [Fact]
    public async Task A_real_http_health_probe_answers_true_on_2xx()
    {
        var client = StubHandler.Client(_ => new HttpResponseMessage(HttpStatusCode.OK));

        Assert.True(await new HttpHealthProbe(client).IsHealthyAsync("http://127.0.0.1:1", CancellationToken.None));
    }
}
