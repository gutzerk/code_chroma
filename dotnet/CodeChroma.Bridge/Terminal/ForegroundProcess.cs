using System.Diagnostics;

namespace CodeChroma.Bridge.Terminal;

/// <summary>The command attached to a PTY's foreground, so a nested vim is not read as an agent state (screen_tap.py foreground_process).</summary>
public sealed class ForegroundProcess(int childPid, Func<IReadOnlyList<string>, string?>? ps = null, double cacheSeconds = 1.0)
{
    private readonly Func<IReadOnlyList<string>, string?> _ps = ps ?? RunPs;
    private readonly object _gate = new();
    private string? _name;
    private DateTime _checkedAt = DateTime.MinValue;
    private Task? _probe;

    /// <summary>Unix only: tcgetpgrp has no ConPTY equivalent, so Windows reports null and the detector applies no process filter.</summary>
    public static bool Supported => !OperatingSystem.IsWindows();

    /// <summary>The cached name; refreshed off-thread at most once per cache window because `ps` costs a fork.</summary>
    public string? Current(DateTime? now = null)
    {
        if (!Supported && ps is null) return null;
        var at = now ?? DateTime.UtcNow;
        lock (_gate)
        {
            if ((at - _checkedAt).TotalSeconds >= cacheSeconds && (_probe is null || _probe.IsCompleted))
            {
                _checkedAt = at;
                _probe = Task.Run(() =>
                {
                    var name = Resolve(childPid, _ps);
                    lock (_gate) _name = name;
                });
            }
            return _name;
        }
    }

    /// <summary>The foreground group's command: `ps -o tpgid=` on the PTY child names the group, a second `ps -o comm=` names it.</summary>
    public static string? Resolve(int pid, Func<IReadOnlyList<string>, string?> ps)
    {
        try
        {
            var group = ps(["-o", "tpgid=", "-p", pid.ToString()])?.Trim();
            if (!int.TryParse(group, out var pgid) || pgid <= 0) return null;
            var command = ps(["-o", "comm=", "-p", pgid.ToString()])?.Trim();
            return string.IsNullOrEmpty(command) ? null : Path.GetFileName(command);
        }
        catch (Exception error) when (error is IOException or InvalidOperationException or System.ComponentModel.Win32Exception)
        {
            return null;
        }
    }

    private static string? RunPs(IReadOnlyList<string> args)
    {
        var info = new ProcessStartInfo("ps") { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var arg in args) info.ArgumentList.Add(arg);
        using var process = Process.Start(info);
        if (process is null) return null;
        if (!process.WaitForExit(2000))
        {
            try { process.Kill(); } catch (InvalidOperationException) { }
            return null;
        }
        return process.ExitCode == 0 ? process.StandardOutput.ReadToEnd() : null;
    }
}
