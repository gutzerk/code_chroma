using CodeChroma.Bridge.Skills;

namespace CodeChroma.Bridge.Tests.Skills;

public sealed class RuntimeEnvironmentTests : IDisposable
{
    private readonly string _home = Path.Combine(Path.GetTempPath(), "cc-runtime-" + Guid.NewGuid().ToString("N")[..8]);
    private readonly List<string> _probes = [];

    public RuntimeEnvironmentTests() => Directory.CreateDirectory(_home);

    public void Dispose()
    {
        try { Directory.Delete(_home, recursive: true); } catch (IOException) { }
    }

    /// <summary>Creates an executable file named <paramref name="name"/> (.exe on Windows) and returns its path.</summary>
    internal static string Executable(string directory, string name)
    {
        Directory.CreateDirectory(directory);
        var path = Path.Combine(directory, name + (OperatingSystem.IsWindows() ? ".exe" : ""));
        File.WriteAllText(path, "#!/bin/sh\n");
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        return path;
    }

    private RuntimeEnvironment Service(string? inheritedPath = null, ShellProbe? probe = null, RuntimeSettings? settings = null)
    {
        var inherited = new Dictionary<string, string>
        {
            ["HOME"] = _home, ["USERPROFILE"] = _home, ["PATH"] = inheritedPath ?? Path.Combine(_home, "inherited"),
            ["TOKEN"] = "inherited-secret",
        };
        return new RuntimeEnvironment(() => settings ?? RuntimeSettings.Defaults, inherited, probe: probe ?? ((_, _, _, _) =>
        {
            _probes.Add("probe");
            return new ProbeResult([], "failed", [], "fish");
        }));
    }

    private ShellProbe Captures(string path, params (string, string)[] extra) => (_, _, _, _) =>
    {
        _probes.Add("probe");
        var captured = new Dictionary<string, string> { ["PATH"] = path };
        foreach (var (k, v) in extra) captured[k] = v;
        return new ProbeResult(captured, null, [], "fish");
    };

    private static void SamePath(string expected, string actual) =>
        Assert.Equal(expected, actual, ignoreCase: OperatingSystem.IsWindows());

    private string ShellPath() => Executable(Path.Combine(_home, "shells"), "fakeshell");

    [Fact]
    public void An_inherited_claude_resolves_from_the_inherited_path()
    {
        var path = Executable(Path.Combine(_home, "inherited"), "claude");
        var service = Service();

        var found = service.Resolve("claude");

        SamePath(path, found.Executable);
        Assert.Equal("inherited environment + fallback locations", found.PathSource);
    }

    [Fact]
    public void Login_shell_capture_overrides_and_is_the_source_when_it_succeeds()
    {
        var managed = Path.Combine(_home, "managed");
        var path = Executable(managed, "claude");
        var service = Service(settings: new RuntimeSettings(ShellPath(), 5, new Dictionary<string, string>()), probe: Captures(managed, ("TOKEN", "shell-secret")));

        var found = service.Resolve("claude");

        SamePath(path, found.Executable);
        Assert.Equal("login shell", found.PathSource);
        Assert.Equal("shell-secret", service.Snapshot().Environment["TOKEN"]);
    }

    [Fact]
    public void Diagnostics_list_variable_names_but_never_values()
    {
        var service = Service();

        var text = service.Snapshot().Diagnostics().ToJsonString();

        Assert.Contains("TOKEN", text);
        Assert.DoesNotContain("inherited-secret", text);
    }

    [Fact]
    public void Spawn_env_drops_internal_settings_but_keeps_the_workspace_identity()
    {
        var service = Service();

        var env = service.SpawnEnv(new Dictionary<string, string>
        {
            ["CODECHROMA_RESOLVING_ENVIRONMENT"] = "1", ["codechroma_RUNTIME_SETTINGS_FILE"] = "x", ["codechroma_WORKSPACE_ID"] = "agent",
        });

        Assert.DoesNotContain("CODECHROMA_RESOLVING_ENVIRONMENT", env.Keys);
        Assert.DoesNotContain("codechroma_RUNTIME_SETTINGS_FILE", env.Keys);
        Assert.Equal("agent", env["codechroma_WORKSPACE_ID"]);
    }

    [Fact]
    public void An_explicit_override_is_used_as_is_and_never_falls_back()
    {
        var custom = Executable(Path.Combine(_home, "custom"), "claude");
        var good = Service(settings: new RuntimeSettings(null, 10, new Dictionary<string, string> { ["claude"] = custom }));
        SamePath(custom, good.Resolve("claude").Executable);
        var missing = Service(settings: new RuntimeSettings(null, 10, new Dictionary<string, string> { ["claude"] = Path.Combine(_home, "custom", "missing") }));

        var error = Assert.Throws<CliLookupException>(() => missing.Resolve("claude", recheck: true));

        Assert.Contains("does not exist", error.Message);
    }

    [Fact]
    public void A_well_known_fallback_location_is_added_to_the_launch_path_even_from_cache()
    {
        var directory = Path.Combine(_home, ".local", "bin");
        var path = Executable(directory, "claude");
        var service = Service(settings: new RuntimeSettings(ShellPath(), 5, new Dictionary<string, string>()), probe: Captures(Path.Combine(_home, "managed")));

        var first = service.Resolve("claude");
        var second = service.Resolve("claude");

        Assert.Equal("well-known executable location", first.PathSource);
        SamePath(path, second.Executable);
        Assert.Equal(first.Env["PATH"], second.Env["PATH"]);
        Assert.Contains(directory, first.Env["PATH"].Split(Path.PathSeparator));
    }

    [Fact]
    public void Negative_lookups_are_cached_and_recapture_is_rate_limited()
    {
        var service = Service(settings: new RuntimeSettings(ShellPath(), 5, new Dictionary<string, string>()));
        for (var i = 0; i < 3; i++) Assert.Throws<CliLookupException>(() => service.Resolve("not-installed"));
        Assert.True(_probes.Count <= 1, $"probed {_probes.Count} times");
        var installed = Executable(Path.Combine(_home, "inherited"), "not-installed");

        var found = service.Resolve("not-installed", recheck: true);

        SamePath(installed, found.Executable);
    }

    [Fact]
    public void Refresh_invalidates_the_positive_cache_and_bumps_the_generation()
    {
        var first = Executable(Path.Combine(_home, "inherited"), "claude");
        var service = Service(settings: new RuntimeSettings(ShellPath(), 5, new Dictionary<string, string>()), probe: Captures(Path.Combine(_home, "inherited")));
        var original = service.Resolve("claude");
        var secondDir = Path.Combine(_home, "new");
        var second = Executable(secondDir, "claude");
        var service2 = Service(settings: new RuntimeSettings(ShellPath(), 5, new Dictionary<string, string>()), probe: Captures(secondDir));
        var original2 = service2.Resolve("claude");

        service2.Refresh("Re-detect", force: true).GetAwaiter().GetResult();
        var resolved = service2.Resolve("claude");

        SamePath(first, original.Executable);
        Assert.Equal(original2.Generation + 1, resolved.Generation);
        SamePath(second, resolved.Executable);
    }

    [Fact]
    public void A_launch_failure_invalidates_the_resolution_cache_and_requests_a_refresh()
    {
        Executable(Path.Combine(_home, "inherited"), "claude");
        var service = Service();
        service.Resolve("claude");

        service.LaunchFailed(new System.ComponentModel.Win32Exception(2, "not found"));

        Assert.Equal(0, service.RecordCount);
        Assert.Equal("executable launch failed", service.LastRefreshReason);
    }

    [Fact]
    public void A_non_launch_exception_leaves_the_cache_alone()
    {
        Executable(Path.Combine(_home, "inherited"), "claude");
        var service = Service();
        service.Resolve("claude");

        service.LaunchFailed(new InvalidOperationException("boom"));

        Assert.Equal(1, service.RecordCount);
    }

    [Fact]
    public void Shell_selection_prefers_the_setting_then_the_environment_and_warns_on_a_bad_one()
    {
        bool Exec(string p) => p is "/settings/fish" or "/env/bash";
        var inherited = new Dictionary<string, string> { ["SHELL"] = "/env/bash" };

        var (chosen, _) = RuntimeEnvironment.SelectShell(new RuntimeSettings("/settings/fish", 10, new Dictionary<string, string>()), inherited, Exec);
        var (fallback, warnings) = RuntimeEnvironment.SelectShell(new RuntimeSettings("/missing", 10, new Dictionary<string, string>()), inherited, Exec);

        Assert.Equal(Path.GetFullPath("/settings/fish"), chosen);
        Assert.Equal(Path.GetFullPath("/env/bash"), fallback);
        Assert.NotEmpty(warnings);
    }

    [Fact]
    public void Path_entries_are_absolute_ordered_and_deduplicated()
    {
        var a = Path.Combine(_home, "a");
        var b = Path.Combine(_home, "b");

        var entries = RuntimeEnvironment.PathEntries($"relative{Path.PathSeparator}{a}{Path.PathSeparator}{b}", $"{a}{Path.PathSeparator}");

        Assert.Equal([a, b], entries);
    }

    [Fact]
    public void Concurrent_starts_share_one_capture()
    {
        var service = Service(settings: new RuntimeSettings(ShellPath(), 5, new Dictionary<string, string>()), probe: Captures(Path.Combine(_home, "p")));

        var tasks = Enumerable.Range(0, 5).Select(_ => Task.Run(() => service.Snapshot())).ToArray();
        Task.WaitAll(tasks);

        Assert.Single(_probes);
        Assert.All(tasks, t => Assert.Equal(1, t.Result.Generation));
    }

    [Fact]
    public void A_throwing_probe_falls_back_without_leaking_values()
    {
        var service = Service(settings: new RuntimeSettings(ShellPath(), 5, new Dictionary<string, string>()), probe: (_, _, _, _) => throw new InvalidOperationException("secret-in-message"));

        var snapshot = service.Snapshot();

        Assert.Equal("Capture failed (InvalidOperationException)", snapshot.CaptureError);
        Assert.DoesNotContain("secret-in-message", snapshot.Diagnostics().ToJsonString());
        Assert.Equal("inherited environment + fallback locations", snapshot.Source);
    }

    [Fact]
    public void Diagnose_reports_the_environment_and_the_failed_resolution()
    {
        var service = Service();

        var result = service.Diagnose("missing-cli");

        Assert.NotNull(result["environment"]);
        Assert.Contains("executable not found", result["resolution"]!["failure_reason"]!.GetValue<string>());
    }

    [Fact]
    public void The_real_probe_captures_a_login_shell_environment()
    {
        var (shell, args) = OperatingSystem.IsWindows()
            ? (Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), 0)
            : ("/bin/sh", 0);
        if (!File.Exists(shell) || args != 0) return;
        var inherited = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["PATH"] = Environment.GetEnvironmentVariable("PATH") ?? "", ["HOME"] = _home, ["CC_PROBE_VALUE"] = "from-parent",
            ["SystemRoot"] = Environment.GetEnvironmentVariable("SystemRoot") ?? "",
        };
        var service = new RuntimeEnvironment(() => new RuntimeSettings(shell, 20, new Dictionary<string, string>()), inherited);

        var snapshot = service.Snapshot();

        Assert.Equal("login shell", snapshot.Source);
        Assert.Equal("from-parent", snapshot.Environment["CC_PROBE_VALUE"]);
    }
}
