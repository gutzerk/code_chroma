using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
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
    int FindFreePort(string repoPath);
}

public interface IHealthProbe
{
    Task<bool> IsHealthyAsync(string origin, CancellationToken ct);
}

public sealed record BridgeHandle(int Port, string Origin, IBridgeProcess Process);

/// <summary>Starts one bridge on the repo's stable port (free fallback); ready = the "bridge ready at" line (launch.py contract) or /health answering.</summary>
public sealed partial class BridgeManager(IBridgeProcessLauncher launcher, IPortFinder ports, IHealthProbe health, TimeSpan? pollInterval = null)
{
    public static readonly TimeSpan DefaultReadyTimeout = TimeSpan.FromMinutes(10);

    [GeneratedRegex(@"bridge ready at\b", RegexOptions.IgnoreCase)]
    private static partial Regex ReadyLine();

    public async Task<BridgeHandle> StartAsync(string executable, string repoPath, Action<string>? onProgress = null, TimeSpan? readyTimeout = null, CancellationToken ct = default)
    {
        var port = ports.FindFreePort(repoPath);
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
        try
        {
            while (DateTime.UtcNow < deadline)
            {
                ct.ThrowIfCancellationRequested();
                if (ready.Task.IsCompleted) return Ready(repoPath, port, origin, process);
                if (process.HasExited) throw new InvalidOperationException(process.ExitDescription ?? "bridge exited");
                if (await health.IsHealthyAsync(origin, ct)) return Ready(repoPath, port, origin, process);
                await Task.WhenAny(ready.Task, process.Exited, Task.Delay(poll, ct));
            }
        }
        catch
        {
            await StopAsync(process);
            throw;
        }
        await StopAsync(process);
        throw new TimeoutException($"bridge did not become ready within {(int)timeout.TotalMilliseconds}ms");
    }

    private static BridgeHandle Ready(string repoPath, int port, string origin, IBridgeProcess process)
    {
        BridgeEndpointFile.Write(repoPath, port, origin);
        return new BridgeHandle(port, origin, process);
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
        foreach (var task in all)
        {
            try { await BridgeManager.StopAsync((await task).Process); }
            catch (Exception e) when (e is InvalidOperationException or TimeoutException or IOException or System.ComponentModel.Win32Exception or OperationCanceledException) { }
        }
    }
}

/// <summary>Records the live bridge URL in the repo so agents re-read it after a restart instead of trusting a port baked into a task.</summary>
public static class BridgeEndpointFile
{
    public const string RelativePath = ".codechroma/bridge.json";

    public static void Write(string repoPath, int port, string origin)
    {
        try
        {
            var path = Path.Combine(repoPath, ".codechroma", "bridge.json");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var json = System.Text.Json.JsonSerializer.Serialize(new { origin, port, updated_at = DateTimeOffset.UtcNow });
            var temp = path + ".tmp";
            File.WriteAllText(temp, json);
            File.Move(temp, path, overwrite: true);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
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

/// <summary>Same repo, same port across restarts (hash of its canonical path, so agent URLs stay valid); next free port when taken.</summary>
public sealed class TcpPortFinder : IPortFinder
{
    public const int RangeStart = 20000;
    public const int RangeSize = 12000;
    private const int Attempts = 64;

    public int FindFreePort(string repoPath)
    {
        var preferred = PreferredPort(repoPath);
        for (var step = 0; step < Attempts; step++)
        {
            var port = RangeStart + (preferred - RangeStart + step) % RangeSize;
            if (TryBind(port)) return port;
        }
        var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        try { return ((IPEndPoint)probe.LocalEndpoint).Port; }
        finally { probe.Stop(); }
    }

    public static int PreferredPort(string repoPath)
    {
        var hash = 2166136261u;
        foreach (var b in System.Text.Encoding.UTF8.GetBytes(RepoPaths.Canonical(repoPath))) hash = (hash ^ b) * 16777619u;
        return RangeStart + (int)(hash % RangeSize);
    }

    private static bool TryBind(int port)
    {
        var probe = new TcpListener(IPAddress.Loopback, port);
        try { probe.Start(); return true; }
        catch (SocketException) { return false; }
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
        BridgeJob.Assign(process);
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

/// <summary>Windows Job Object with KILL_ON_JOB_CLOSE so bridges die with the shell even if it crashes; a no-op elsewhere.</summary>
internal static class BridgeJob
{
    private static readonly Lazy<IntPtr> Job = new(Create);

    public static void Assign(Process process)
    {
        if (!OperatingSystem.IsWindows() || Job.Value == IntPtr.Zero) return;
        try { AssignProcessToJobObject(Job.Value, process.Handle); }
        catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { }
    }

    private static IntPtr Create()
    {
        if (!OperatingSystem.IsWindows()) return IntPtr.Zero;
        var job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) return IntPtr.Zero;
        var info = new ExtendedLimitInformation { BasicLimitInformation = new BasicLimitInformation { LimitFlags = KillOnJobClose } };
        var size = Marshal.SizeOf<ExtendedLimitInformation>();
        var buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(info, buffer, false);
            return SetInformationJobObject(job, ExtendedLimitInformationClass, buffer, (uint)size) ? job : IntPtr.Zero;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private const uint KillOnJobClose = 0x2000;
    private const int ExtendedLimitInformationClass = 9;

    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimitInformation
    {
        public BasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string? name);

    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint size);

    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
}
