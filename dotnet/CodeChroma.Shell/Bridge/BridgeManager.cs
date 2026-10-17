using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;

namespace CodeChroma.Shell;

public sealed record BridgeLaunchSpec(string Executable, string RepoPath, int Port, Action<string> OnLine);

public interface IBridgeProcess
{
    bool HasExited { get; }

    string? ExitDescription { get; }

    Task Exited { get; }

    Task StopAsync(TimeSpan grace);
}

public interface IBridgeProcessLauncher
{
    IBridgeProcess Start(BridgeLaunchSpec spec);
}

public interface IPortFinder
{
    int FindFreePort();
}

public interface IHealthProbe
{
    Task<bool> IsHealthyAsync(string origin, CancellationToken ct);
}

public sealed record BridgeHandle(int Port, string Origin, IBridgeProcess Process);

/// <summary>Starts one bridge on a free port; ready = the "bridge ready at" line (launch.py contract) or /health answering.</summary>
public sealed partial class BridgeManager(IBridgeProcessLauncher launcher, IPortFinder ports, IHealthProbe health, TimeSpan? pollInterval = null)
{
    public static readonly TimeSpan DefaultReadyTimeout = TimeSpan.FromMinutes(10);

    [GeneratedRegex(@"bridge ready at\b", RegexOptions.IgnoreCase)]
    private static partial Regex ReadyLine();

    public async Task<BridgeHandle> StartAsync(string executable, string repoPath, Action<string>? onProgress = null, TimeSpan? readyTimeout = null, CancellationToken ct = default)
    {
        var port = ports.FindFreePort();
        var origin = $"http://127.0.0.1:{port}";
        var ready = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        void OnLine(string raw)
        {
            var line = raw.Trim();
            if (line.Length == 0) return;
            onProgress?.Invoke(line);
            if (ReadyLine().IsMatch(line)) ready.TrySetResult();
        }

        var process = launcher.Start(new BridgeLaunchSpec(executable, repoPath, port, OnLine));
        var timeout = readyTimeout ?? DefaultReadyTimeout;
        var deadline = DateTime.UtcNow + timeout;
        var poll = pollInterval ?? TimeSpan.FromMilliseconds(400);
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            if (ready.Task.IsCompleted) return new BridgeHandle(port, origin, process);
            if (process.HasExited) throw new InvalidOperationException(process.ExitDescription ?? "bridge exited");
            if (await health.IsHealthyAsync(origin, ct)) return new BridgeHandle(port, origin, process);
            await Task.WhenAny(ready.Task, process.Exited, Task.Delay(poll, ct));
        }
        await StopAsync(process);
        throw new TimeoutException($"bridge did not become ready within {(int)timeout.TotalMilliseconds}ms");
    }

    public static async Task StopAsync(IBridgeProcess? process, TimeSpan? grace = null)
    {
        if (process is null || process.HasExited) return;
        await process.StopAsync(grace ?? TimeSpan.FromSeconds(5));
    }
}

/// <summary>One bridge per repo; a crashed one is respawned on the next request, other repos are untouched.</summary>
public sealed class BridgeRegistry(BridgeManager manager, string executable)
{
    private readonly Dictionary<string, Task<BridgeHandle>> bridges = [];
    private readonly object gate = new();

    public Task<BridgeHandle> EnsureAsync(string repoPath, Action<string>? onProgress = null, CancellationToken ct = default)
    {
        var key = RepoPaths.Canonical(repoPath);
        lock (gate)
        {
            if (bridges.TryGetValue(key, out var existing) && !(existing.IsFaulted || existing.IsCanceled || (existing.IsCompletedSuccessfully && existing.Result.Process.HasExited)))
                return existing;
            var started = manager.StartAsync(executable, repoPath, onProgress, ct: ct);
            bridges[key] = started;
            return started;
        }
    }

    public async Task StopAllAsync()
    {
        Task<BridgeHandle>[] all;
        lock (gate) all = [.. bridges.Values];
        foreach (var task in all.Where(t => t.IsCompletedSuccessfully))
            await BridgeManager.StopAsync((await task).Process);
    }
}

public static class RepoPaths
{
    public static string Canonical(string repoPath)
    {
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(repoPath));
        try
        {
            if (Directory.Exists(full) && new DirectoryInfo(full).ResolveLinkTarget(true) is { } target) full = target.FullName;
        }
        catch (IOException) { }
        return OperatingSystem.IsWindows() ? full.ToLowerInvariant() : full;
    }
}

public sealed class TcpPortFinder : IPortFinder
{
    public int FindFreePort()
    {
        var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        try { return ((IPEndPoint)probe.LocalEndpoint).Port; }
        finally { probe.Stop(); }
    }
}

public sealed class HttpHealthProbe(HttpClient http) : IHealthProbe
{
    public async Task<bool> IsHealthyAsync(string origin, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromMilliseconds(1500));
        try
        {
            using var response = await http.GetAsync($"{origin}/health", timeout.Token);
            return response.IsSuccessStatusCode;
        }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException)
        {
            ct.ThrowIfCancellationRequested();
            return false;
        }
    }
}

public sealed class ProcessBridgeLauncher : IBridgeProcessLauncher
{
    public IBridgeProcess Start(BridgeLaunchSpec spec)
    {
        var info = new ProcessStartInfo(spec.Executable)
        {
            WorkingDirectory = spec.RepoPath,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var argument in new[] { "--repo-path", spec.RepoPath, "--port", spec.Port.ToString() }) info.ArgumentList.Add(argument);
        var process = new Process { StartInfo = info, EnableRaisingEvents = true };
        process.OutputDataReceived += (_, e) => { if (e.Data is not null) spec.OnLine(e.Data); };
        process.ErrorDataReceived += (_, e) => { if (e.Data is not null) spec.OnLine(e.Data); };
        var wrapper = new RealProcess(process);
        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        wrapper.Watch();
        return wrapper;
    }

    private sealed class RealProcess(Process process) : IBridgeProcess
    {
        private readonly TaskCompletionSource exited = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public bool HasExited => exited.Task.IsCompleted;

        public string? ExitDescription { get; private set; }

        public Task Exited => exited.Task;

        public void Watch() => _ = Task.Run(() =>
        {
            process.WaitForExit();
            ExitDescription = $"bridge exited (code {process.ExitCode})";
            exited.TrySetResult();
        });

        public async Task StopAsync(TimeSpan grace)
        {
            if (HasExited) return;
            try { process.Kill(entireProcessTree: true); }
            catch (InvalidOperationException) { }
            await Task.WhenAny(exited.Task, Task.Delay(grace));
        }
    }
}
