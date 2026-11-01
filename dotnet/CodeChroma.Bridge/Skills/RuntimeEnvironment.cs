using System.ComponentModel;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Skills;

/// <summary>The machine-level shell capture and per-executable escape hatches (runtime-environment.json).</summary>
public sealed record RuntimeSettings(string? Shell, double TimeoutSeconds, IReadOnlyDictionary<string, string> CliPaths)
{
    public static RuntimeSettings Defaults { get; } = new(null, 10.0, new Dictionary<string, string>());

    public static RuntimeSettings From(JsonObject validated) => new(
        Json.Str(validated["shell"]),
        validated["timeout_seconds"]!.GetValue<double>(),
        validated["cli_paths"]!.AsObject().ToDictionary(kv => kv.Key, kv => Json.Str(kv.Value)!));
}

public sealed class CliLookupException(string message) : Exception(message);

public sealed class CliLaunchException(string message) : Exception(message);

public sealed record ProbeResult(Dictionary<string, string> Captured, string? Error, IReadOnlyList<string> Warnings, string Kind);

public delegate ProbeResult ShellProbe(string shell, string home, IReadOnlyDictionary<string, string> inherited, double timeoutSeconds);

/// <summary>One immutable view of the environment: the merged variables and where PATH came from.</summary>
public sealed class EnvironmentSnapshot
{
    public required int Generation { get; init; }
    public required IReadOnlyDictionary<string, string> Environment { get; init; }
    public required IReadOnlyDictionary<string, string> CapturedEnvironment { get; init; }
    public required IReadOnlyList<string> Path { get; init; }
    public required string Source { get; init; }
    public string? Shell { get; init; }
    public string? ShellType { get; init; }
    public double CapturedAt { get; init; }
    public double DurationSeconds { get; init; }
    public IReadOnlyList<string> Warnings { get; init; } = [];
    public string? CaptureError { get; init; }

    /// <summary>Variable names only; values never leave the process.</summary>
    public JsonObject Diagnostics() => new()
    {
        ["generation"] = Generation,
        ["source"] = Source,
        ["shell"] = Shell,
        ["shell_type"] = ShellType,
        ["captured_at"] = CapturedAt,
        ["duration_seconds"] = DurationSeconds,
        ["path"] = new JsonArray(Path.Select(p => (JsonNode?)p).ToArray()),
        ["variable_names"] = new JsonArray(Environment.Keys.Order(StringComparer.Ordinal).Select(k => (JsonNode?)k).ToArray()),
        ["warnings"] = new JsonArray(Warnings.Select(w => (JsonNode?)w).ToArray()),
        ["capture_error"] = CaptureError,
    };
}

public sealed record RuntimeCli(string Executable, IReadOnlyDictionary<string, string> Env, string PathSource, int Generation, double ResolvedAt, string? Version = null)
{
    /// <summary>Only the OS-provided reason is shown; arbitrary messages may embed credentials.</summary>
    public string LaunchError(Exception error) =>
        $"Resolved CLI '{Executable}', but process launch failed ({PathSource}, environment {Generation}): {(error is Win32Exception w ? w.Message : error.GetType().Name)}";
}

public sealed record ResolutionRecord(string Name, string? Executable, string Source, int Generation, double Timestamp, string? FailureReason = null, string? Version = null)
{
    public JsonObject Diagnostics() => new()
    {
        ["name"] = Name, ["executable"] = Executable, ["source"] = Source, ["generation"] = Generation,
        ["timestamp"] = Timestamp, ["failure_reason"] = FailureReason, ["version"] = Version,
    };
}

/// <summary>Thread-safe, process-wide environment capture and generation-scoped CLI lookup caches.</summary>
public sealed class RuntimeEnvironment
{
    private readonly object _lock = new();
    private readonly Func<RuntimeSettings> _settings;
    private readonly bool _readSettings;
    private readonly ShellProbe _probe;
    private readonly Dictionary<string, string> _inherited;
    private readonly string _platform;
    private readonly string _home;
    private readonly Func<string> _registryPath;
    private readonly Dictionary<(string Name, string Path, int Generation), ResolutionRecord> _records = [];
    private Task<EnvironmentSnapshot>? _future;
    private EnvironmentSnapshot? _snapshot;
    private long _lastCapture = long.MinValue / 2;

    public RuntimeEnvironment(Func<RuntimeSettings>? settings = null, IReadOnlyDictionary<string, string>? inherited = null,
        string? platform = null, ShellProbe? probe = null, Func<string>? registryPath = null)
    {
        _readSettings = settings is not null;
        _settings = settings ?? (() => RuntimeSettings.Defaults);
        Options = _settings();
        _platform = platform ?? (OperatingSystem.IsWindows() ? "win32" : "posix");
        _inherited = new Dictionary<string, string>(inherited ?? Inherit(), Comparer);
        _home = _inherited.GetValueOrDefault("HOME") ?? _inherited.GetValueOrDefault("USERPROFILE")
            ?? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        _probe = probe ?? DefaultProbe;
        _registryPath = registryPath ?? RegistryPath;
    }

    public RuntimeSettings Options { get; set; }

    public string Home => _home;

    /// <summary>The reason of the most recent refresh request (tests and diagnostics).</summary>
    public string? LastRefreshReason { get; private set; }

    public int RecordCount
    {
        get { lock (_lock) return _records.Count; }
    }

    private StringComparer Comparer => _platform == "win32" ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;

    private static Dictionary<string, string> Inherit()
    {
        var result = new Dictionary<string, string>(OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal);
        foreach (System.Collections.DictionaryEntry entry in Environment.GetEnvironmentVariables())
            result[(string)entry.Key] = (string?)entry.Value ?? "";
        return result;
    }

    public Task<EnvironmentSnapshot> Start()
    {
        lock (_lock) return _future ?? Refresh("startup", force: true);
    }

    public EnvironmentSnapshot Snapshot()
    {
        var pending = Start();
        lock (_lock)
        {
            if (_snapshot is not null) return _snapshot;
        }
        return pending.GetAwaiter().GetResult();
    }

    public async Task<EnvironmentSnapshot> SnapshotAsync()
    {
        var pending = Start();
        lock (_lock)
        {
            if (_snapshot is not null) return _snapshot;
        }
        return await pending;
    }

    public Task<EnvironmentSnapshot> Refresh(string reason, bool force = false)
    {
        lock (_lock)
        {
            LastRefreshReason = reason;
            if (_future is { IsCompleted: false }) return _future;
            if (!force && Environment.TickCount64 - _lastCapture < 30_000 && _future is not null) return _future;
            _lastCapture = Environment.TickCount64;
            if (_readSettings) Options = _settings();
            return _future = Task.Run(Capture);
        }
    }

    private EnvironmentSnapshot Capture()
    {
        var started = Environment.TickCount64;
        var captured = new Dictionary<string, string>(Comparer);
        string? error = null;
        IReadOnlyList<string> warnings = [];
        string? shell = null, kind = null;
        try
        {
            var options = Options;
            if (_platform != "win32" || options.Shell is not null)
            {
                (shell, warnings) = SelectShell(options, _inherited);
                if (shell is not null)
                {
                    var probe = _probe(shell, _home, _inherited, options.TimeoutSeconds);
                    captured = new Dictionary<string, string>(probe.Captured, Comparer);
                    error = probe.Error;
                    kind = probe.Kind;
                    warnings = [.. warnings, .. probe.Warnings];
                }
            }
            var inherited = Clean(_inherited);
            if (_platform == "win32") inherited["PATH"] = WindowsPath(inherited.GetValueOrDefault("PATH") ?? "");
            var exported = Clean(captured);
            var merged = new Dictionary<string, string>(inherited, Comparer);
            foreach (var (k, v) in exported) merged[k] = v;
            var path = PathEntries(exported.GetValueOrDefault("PATH") ?? "", inherited.GetValueOrDefault("PATH") ?? "");
            if (captured.Count == 0) path = PathEntries(string.Join(Path.PathSeparator, path), string.Join(Path.PathSeparator, FallbackDirs()));
            merged["PATH"] = string.Join(Path.PathSeparator, path);
            if (shell is not null) merged["SHELL"] = shell;
            return Publish(merged, Clean(captured), path, captured.Count > 0 ? "login shell" : "inherited environment + fallback locations",
                shell, kind, started, warnings, error);
        }
        catch (Exception exception)
        {
            var merged = Clean(_inherited);
            if (_platform == "win32") merged["PATH"] = WindowsPath(merged.GetValueOrDefault("PATH") ?? "");
            var path = PathEntries(merged.GetValueOrDefault("PATH") ?? "", string.Join(Path.PathSeparator, FallbackDirs()));
            merged["PATH"] = string.Join(Path.PathSeparator, path);
            return Publish(merged, [], path, "inherited environment + fallback locations", shell, kind, started, warnings,
                $"Capture failed ({exception.GetType().Name})");
        }
    }

    private EnvironmentSnapshot Publish(Dictionary<string, string> merged, Dictionary<string, string> captured, IReadOnlyList<string> path,
        string source, string? shell, string? kind, long started, IReadOnlyList<string> warnings, string? error)
    {
        lock (_lock)
        {
            var snapshot = new EnvironmentSnapshot
            {
                Generation = _snapshot is null ? 1 : _snapshot.Generation + 1,
                Environment = merged, CapturedEnvironment = captured, Path = path, Source = source, Shell = shell, ShellType = kind,
                CapturedAt = Now(),
                DurationSeconds = (Environment.TickCount64 - started) / 1000.0,
                Warnings = warnings, CaptureError = error,
            };
            _snapshot = snapshot;
            _records.Clear();
            return snapshot;
        }
    }

    public Dictionary<string, string> SpawnEnv(IReadOnlyDictionary<string, string>? extra = null, EnvironmentSnapshot? snapshot = null)
    {
        var merged = new Dictionary<string, string>((snapshot ?? Snapshot()).Environment, Comparer);
        foreach (var (k, v) in extra ?? new Dictionary<string, string>()) merged[k] = v;
        return Clean(merged);
    }

    /// <summary>How long a PTY spawn waits for the login-shell capture before falling back to the inherited environment.</summary>
    public static readonly TimeSpan TerminalWait = TimeSpan.FromSeconds(10);

    /// <summary>The full inherited environment under the login-shell snapshot and the caller's overrides, uncleaned: an interactive shell keeps `codechroma_*` and exported functions.</summary>
    public Dictionary<string, string> TerminalEnv(IReadOnlyDictionary<string, string>? extra = null)
    {
        var pending = SnapshotAsync();
        return Overlay(pending.Wait(TerminalWait) ? pending.Result : null, extra);
    }

    public async Task<Dictionary<string, string>> TerminalEnvAsync(IReadOnlyDictionary<string, string>? extra, CancellationToken cancel)
    {
        EnvironmentSnapshot? snapshot = null;
        try { snapshot = await SnapshotAsync().WaitAsync(TerminalWait, cancel); }
        catch (TimeoutException) { }
        return Overlay(snapshot, extra);
    }

    private Dictionary<string, string> Overlay(EnvironmentSnapshot? snapshot, IReadOnlyDictionary<string, string>? extra)
    {
        var merged = new Dictionary<string, string>(_inherited, Comparer);
        foreach (var (k, v) in snapshot?.Environment ?? new Dictionary<string, string>()) merged[k] = v;
        foreach (var (k, v) in extra ?? new Dictionary<string, string>()) merged[k] = v;
        return merged;
    }

    public RuntimeCli Resolve(string name, IReadOnlyDictionary<string, string>? extra = null, bool recheck = false)
    {
        var snapshot = Snapshot();
        var env = SpawnEnv(extra, snapshot);
        var hasDir = !string.IsNullOrEmpty(Path.GetDirectoryName(name));
        var configured = hasDir ? name : Options.CliPaths.GetValueOrDefault(name, name);
        var expanded = ExpandUser(configured);
        var key = (name, env.GetValueOrDefault("PATH") ?? "", snapshot.Generation);
        var now = Now();
        ResolutionRecord? record;
        lock (_lock) _records.TryGetValue(key, out record);
        if (record is not null && !recheck && record.Executable is not null && IsExecutable(record.Executable))
        {
            if (record.Source == "well-known executable location")
                env["PATH"] = string.Join(Path.PathSeparator, PathEntries(env.GetValueOrDefault("PATH") ?? "", string.Join(Path.PathSeparator, FallbackDirs())));
            return new RuntimeCli(record.Executable, env, record.Source, snapshot.Generation, record.Timestamp, record.Version);
        }
        if (record is { FailureReason: not null } && !recheck && now - record.Timestamp < 3)
            throw new CliLookupException(record.FailureReason);

        var source = snapshot.Source;
        var explicitDir = !string.IsNullOrEmpty(Path.GetDirectoryName(expanded));
        var executable = Which(expanded, env.GetValueOrDefault("PATH") ?? "");
        if (explicitDir) source = "explicit executable path";
        else if (executable is null)
        {
            var fallback = string.Join(Path.PathSeparator, FallbackDirs());
            executable = Which(expanded, fallback);
            if (executable is not null)
            {
                source = "well-known executable location";
                env["PATH"] = string.Join(Path.PathSeparator, PathEntries(env.GetValueOrDefault("PATH") ?? "", fallback));
            }
        }
        if (executable is not null)
        {
            var absolute = Path.GetFullPath(executable);
            lock (_lock) _records[key] = new ResolutionRecord(name, absolute, source, snapshot.Generation, now);
            return new RuntimeCli(absolute, env, source, snapshot.Generation, now);
        }
        var message = explicitDir
            ? $"Configured CLI path '{configured}' {(File.Exists(expanded) || Directory.Exists(expanded) ? "is not executable" : "does not exist")}."
            : $"'{name}' executable not found on PATH ({source}). Install it, click Re-detect, or configure its executable path. Shell aliases/functions are not executable CLI paths.";
        lock (_lock) _records[key] = new ResolutionRecord(name, null, source, snapshot.Generation, now, message);
        if (!explicitDir)
        {
            var pending = Refresh("unresolved CLI");
            if (pending.IsCompletedSuccessfully && pending.Result.Generation != snapshot.Generation) return Resolve(name, extra, recheck: true);
        }
        throw new CliLookupException(message);
    }

    public async Task<EnvironmentSnapshot> Configure(RuntimeSettings options)
    {
        lock (_lock)
        {
            Options = options;
            _records.Clear();
        }
        await Start();
        return await Refresh("settings changed", force: true);
    }

    /// <summary>A missing or unreadable launcher invalidates every cached lookup and recaptures.</summary>
    public void LaunchFailed(Exception error)
    {
        if (error is not (Win32Exception or FileNotFoundException or UnauthorizedAccessException or DirectoryNotFoundException)) return;
        lock (_lock) _records.Clear();
        Refresh("executable launch failed");
    }

    public async Task<EnvironmentSnapshot> RecheckUnresolved()
    {
        var snapshot = await SnapshotAsync();
        string[] names;
        lock (_lock) names = [.. _records.Values.Where(r => r.FailureReason is not null).Select(r => r.Name).Distinct()];
        if (names.Length == 0) return snapshot;
        await Task.Run(() =>
        {
            foreach (var name in names)
                try { Resolve(name, recheck: true); } catch (CliLookupException) { }
        });
        return await SnapshotAsync();
    }

    public JsonObject Diagnose(string name)
    {
        try { Resolve(name); } catch (CliLookupException) { }
        ResolutionRecord? latest;
        lock (_lock) latest = _records.Values.Where(r => r.Name == name).OrderByDescending(r => r.Timestamp).FirstOrDefault();
        return new JsonObject { ["environment"] = Snapshot().Diagnostics(), ["resolution"] = latest?.Diagnostics() };
    }

    private static double Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0;

    private string ExpandUser(string path) => path.StartsWith('~') ? _home + path[1..] : path;

    // -- helpers shared with the tests --

    public static Dictionary<string, string> Clean(IReadOnlyDictionary<string, string> env)
    {
        var result = new Dictionary<string, string>(env.Count, OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal);
        foreach (var (k, v) in env)
        {
            if (k == "CODECHROMA_RESOLVING_ENVIRONMENT" || k.StartsWith("BASH_FUNC_")) continue;
            if (k.StartsWith("codechroma_", StringComparison.OrdinalIgnoreCase) && k is not ("CODECHROMA_BRIDGE_URL" or "CODECHROMA_WORKSPACE_ID")) continue;
            result[k] = v;
        }
        return result;
    }

    /// <summary>The process PATH plus the current user and machine PATH, so tools installed after launch are found.</summary>
    private string WindowsPath(string processPath)
    {
        try { return string.Join(Path.PathSeparator, PathEntries(processPath, _registryPath())); }
        catch (Exception exception) when (exception is System.Security.SecurityException or IOException) { return processPath; }
    }

    private static string RegistryPath() => string.Join(Path.PathSeparator,
        Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.User) ?? "",
        Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.Machine) ?? "");

    private IReadOnlyList<string> FallbackDirs() => _platform == "win32"
        ? [Path.Combine(_home, ".local", "bin"), Path.Combine(_home, "AppData", "Roaming", "npm"), Path.Combine(_home, "scoop", "shims"),
            Path.Combine(_home, "AppData", "Local", "Microsoft", "WinGet", "Links"), Path.Combine(_home, "AppData", "Local", "Volta", "bin"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs")]
        : [Path.Combine(_home, ".local/bin"), Path.Combine(_home, "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"];

    /// <summary>Absolute, de-duplicated PATH entries in order; relative entries (and POSIX-style `/c/...` ones on Windows) are dropped.</summary>
    public static IReadOnlyList<string> PathEntries(params string[] values)
    {
        var seen = new HashSet<string>(OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal);
        var result = new List<string>();
        foreach (var value in values)
            foreach (var entry in value.Split(Path.PathSeparator))
            {
                if (entry.Length == 0 || !Path.IsPathRooted(entry) || (OperatingSystem.IsWindows() && entry[0] == '/')) continue;
                var normalized = Path.GetFullPath(entry).TrimEnd(Path.DirectorySeparatorChar);
                if (normalized.Length == 0) normalized = Path.DirectorySeparatorChar.ToString();
                if (seen.Add(normalized)) result.Add(normalized);
            }
        return result;
    }

    public static (string? Shell, IReadOnlyList<string> Warnings) SelectShell(RuntimeSettings options, IReadOnlyDictionary<string, string> inherited,
        Func<string, bool>? isExecutable = null)
    {
        isExecutable ??= IsExecutable;
        var warnings = new List<string>();
        foreach (var candidate in new[] { options.Shell, inherited.GetValueOrDefault("SHELL") })
        {
            if (string.IsNullOrEmpty(candidate)) continue;
            var expanded = candidate.StartsWith('~') ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) + candidate[1..] : candidate;
            if (isExecutable(expanded)) return (Path.GetFullPath(expanded), warnings);
            warnings.Add(options.Shell == candidate ? "Configured shell is not executable" : "SHELL does not point to an executable");
        }
        return OperatingSystem.IsWindows() ? (null, warnings) : (AccountShell() ?? "/bin/sh", warnings);
    }

    private static string? AccountShell()
    {
        try
        {
            var line = File.ReadLines("/etc/passwd").FirstOrDefault(l => l.StartsWith(Environment.UserName + ":", StringComparison.Ordinal));
            var shell = line?.Split(':').LastOrDefault();
            return shell is not null && IsExecutable(shell) ? shell : null;
        }
        catch (IOException)
        {
            return null;
        }
    }

    public static bool IsExecutable(string path)
    {
        if (string.IsNullOrEmpty(path) || !File.Exists(path)) return false;
        if (OperatingSystem.IsWindows()) return true;
        return (File.GetUnixFileMode(path) & (UnixFileMode.UserExecute | UnixFileMode.GroupExecute | UnixFileMode.OtherExecute)) != 0;
    }

    /// <summary>shutil.which: a name with a directory is checked directly, otherwise each PATH entry in order.</summary>
    public static string? Which(string command, string path)
    {
        var extensions = OperatingSystem.IsWindows()
            ? (Environment.GetEnvironmentVariable("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").Split(';', StringSplitOptions.RemoveEmptyEntries)
            : [];
        IEnumerable<string> Variants(string basePath)
        {
            if (extensions.Length == 0) { yield return basePath; yield break; }
            if (extensions.Any(e => basePath.EndsWith(e, StringComparison.OrdinalIgnoreCase))) yield return basePath;
            else foreach (var extension in extensions) yield return basePath + extension;
        }
        if (!string.IsNullOrEmpty(Path.GetDirectoryName(command)))
            return Variants(command).FirstOrDefault(IsExecutable);
        foreach (var directory in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
            if (Variants(Path.Combine(directory, command)).FirstOrDefault(IsExecutable) is { } found) return found;
        return null;
    }

    private static ProbeResult DefaultProbe(string shell, string home, IReadOnlyDictionary<string, string> inherited, double timeoutSeconds)
    {
        var marker = "CODECHROMA_ENV_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
        var (arguments, kind) = ShellCommand(shell, marker);
        var warnings = new List<string>();
        string? error = null;
        var info = new ProcessStartInfo(shell) { WorkingDirectory = Directory.Exists(home) ? home : Environment.CurrentDirectory, UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, RedirectStandardInput = true, CreateNoWindow = true };
        foreach (var argument in arguments) info.ArgumentList.Add(argument);
        info.Environment.Clear();
        foreach (var (k, v) in Clean(new Dictionary<string, string>(inherited)))
            if (!k.StartsWith("DIRENV_") && !k.StartsWith("MISE_")) info.Environment[k] = v;
        info.Environment["PWD"] = home;
        info.Environment["CODECHROMA_RESOLVING_ENVIRONMENT"] = "1";
        var output = new MemoryStream();
        try
        {
            using var process = Process.Start(info)!;
            process.StandardInput.Close();
            process.ErrorDataReceived += (_, _) => { };
            var copy = Task.Run(() => process.StandardOutput.BaseStream.CopyTo(output));
            _ = Task.Run(() => process.StandardError.ReadToEnd());
            if (!process.WaitForExit(TimeSpan.FromSeconds(timeoutSeconds)))
            {
                error = "Shell environment capture timed out";
                try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                process.WaitForExit();
            }
            else if (process.ExitCode != 0) warnings.Add($"Shell exited with status {process.ExitCode}");
            copy.Wait(TimeSpan.FromSeconds(2));
        }
        catch (Exception exception) when (exception is Win32Exception or IOException)
        {
            return new ProbeResult([], "Shell environment capture could not start", warnings, kind);
        }
        var raw = Encoding.UTF8.GetString(output.ToArray());
        var first = raw.IndexOf(marker, StringComparison.Ordinal);
        var last = first < 0 ? -1 : raw.IndexOf(marker, first + marker.Length, StringComparison.Ordinal);
        if (first >= 0 && last >= 0)
        {
            var captured = new Dictionary<string, string>();
            foreach (var entry in raw[(first + marker.Length)..last].Split('\0', StringSplitOptions.RemoveEmptyEntries))
            {
                var eq = entry.IndexOf('=');
                if (eq <= 0) continue;
                captured[entry[..eq]] = entry[(eq + 1)..];
            }
            if (captured.GetValueOrDefault("PATH") is { Length: > 0 })
            {
                if (error is not null) warnings.Add(error);
                return new ProbeResult(captured, null, warnings, kind);
            }
        }
        return new ProbeResult([], error ?? "Shell did not return a valid environment", warnings, kind);
    }

    private static (string[] Arguments, string Kind) ShellCommand(string shell, string marker)
    {
        var kind = Path.GetFileNameWithoutExtension(shell).ToLowerInvariant();
        if (kind is "pwsh" or "powershell")
        {
            var command = $"[Console]::Out.Write('{marker}'); Get-ChildItem env: | ForEach-Object {{ [Console]::Out.Write($_.Name + '=' + $_.Value + [char]0) }}; [Console]::Out.Write('{marker}')";
            return (["-NoLogo", "-NonInteractive", "-Command", command], kind);
        }
        var posix = $"printf '%s' {marker}; env -0; printf '%s' {marker}";
        return kind is "csh" or "tcsh" ? (["-i", "-c", posix], kind) : (["-l", "-i", "-c", posix], kind);
    }
}
