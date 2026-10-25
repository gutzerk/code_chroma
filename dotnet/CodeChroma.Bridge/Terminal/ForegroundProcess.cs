using System.Diagnostics;

namespace CodeChroma.Bridge.Terminal;

/// <summary>
/// The command name of the process in a PTY's foreground, so `vim` is not read as an agent state. Unix only: `ps -o tpgid=` on the
/// PTY child names the terminal's foreground group (the reference reads the master fd with tcgetpgrp) and a second `ps` names it.
/// ConPTY has no foreground process group, so on Windows the name stays unknown and the detector's process filter is skipped.
/// </summary>
public sealed class ForegroundProcess(int pid, Func<string[], string?>? runPs = null, TimeSpan? cache = null, Func<bool>? supported = null)
{
    private static readonly TimeSpan DefaultCache = TimeSpan.FromSeconds(1);

    private readonly Func<string[], string?> _runPs = runPs ?? RunPs;
    private readonly TimeSpan _cache = cache ?? DefaultCache;
    private readonly bool _supported = (supported ?? (() => !OperatingSystem.IsWindows()))();
    private readonly object _gate = new();
    private DateTime _checkedAt = DateTime.MinValue;
    private Task? _probe;
    private string? _name;

    /// <summary>The last probed name (null when unknown); refreshes at most once per cache window, off the caller's thread.</summary>
    public string? Name(DateTime now)
    {
        if (!_supported) return null;
        lock (_gate)
        {
            if (now - _checkedAt >= _cache)
            {
                _checkedAt = now;
                if (_probe is null || _probe.IsCompleted) _probe = Task.Run(Probe);
            }
            return _name;
        }
    }

    /// <summary>Waits for an in-flight probe; tests use it to observe the refreshed name.</summary>
    public void Settle()
    {
        Task? probe;
        lock (_gate) probe = _probe;
        probe?.Wait();
    }

    private void Probe()
    {
        string? resolved = null;
        try
        {
            var group = _runPs(["-o", "tpgid=", "-p", pid.ToString()])?.Trim();
            if (!string.IsNullOrEmpty(group) && int.TryParse(group, out var pgid) && pgid > 0)
            {
                var command = _runPs(["-o", "comm=", "-p", pgid.ToString()])?.Trim();
                resolved = string.IsNullOrEmpty(command) ? null : Path.GetFileName(command);
            }
        }
        catch (Exception) { /* a probe that fails just leaves the name unknown */ }
        lock (_gate) _name = resolved;
    }

    private static string? RunPs(string[] args)
    {
        var start = new ProcessStartInfo("ps") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var arg in args) start.ArgumentList.Add(arg);
        using var process = Process.Start(start);
        if (process is null) return null;
        var output = process.StandardOutput.ReadToEndAsync();
        if (!process.WaitForExit(2000))
        {
            try { process.Kill(); } catch (Exception) { /* already gone */ }
            return null;
        }
        return process.ExitCode == 0 ? output.GetAwaiter().GetResult() : null;
    }
}
