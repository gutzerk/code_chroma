using System.Text;
using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests.Updater;

/// <summary>Runs the real swap helpers against fake apps: swap, health check, rollback and the result file.</summary>
public class UpdateScriptTests
{
    private const string NoSuchPid = "99999999";

    private sealed class PosixRun : IDisposable
    {
        public TempDir Temp { get; } = new();
        public string Target => HostShell.ForSh(Temp.Sub("app"));
        public string Staged => HostShell.ForSh(Temp.Sub("app.update"));
        public string Previous => HostShell.ForSh(Temp.Sub("app.previous"));
        public string Marker => HostShell.ForSh(Temp.Sub("launched.log"));
        public string UserData => Temp.Dir("userdata");

        public void WriteApp(string path, string body) => WriteScript(path, body);

        public (int ExitCode, string Output) Run(string mode, string keep, IDictionary<string, string>? env = null)
        {
            var script = Temp.Sub(UpdateScripts.PosixName);
            File.WriteAllText(script, UpdateScripts.Posix.Replace("\r\n", "\n"));
            return HostShell.Run(HostShell.Sh!,
            [
                HostShell.ForSh(script), NoSuchPid, mode, Target, Staged, Previous, HostShell.ForSh(PlatformInstaller.ResultPath(UserData)), "2.0.0", "2", keep,
            ], env);
        }

        public void Dispose() => Temp.Dispose();
    }

    [PosixShellFact]
    public void A_healthy_new_version_replaces_the_old_one_and_reports_updated()
    {
        using var run = new PosixRun();
        run.WriteApp(run.Target, $"echo old >> '{run.Marker}'");
        run.WriteApp(run.Staged, "sleep 5");

        var (code, output) = run.Run("exec", keep: "0");

        Assert.True(code == 0, output);
        Assert.Contains("sleep 5", File.ReadAllText(run.Target));
        Assert.False(File.Exists(run.Previous));
        Assert.Equal("updated", InstallOutcomeStore.Read(run.UserData)?.Result);
    }

    [PosixShellFact]
    public void Linux_keeps_the_previous_appimage_after_a_healthy_update()
    {
        using var run = new PosixRun();
        run.WriteApp(run.Target, "exit 0");
        run.WriteApp(run.Staged, "sleep 5");

        var (code, output) = run.Run("exec", keep: "1");

        Assert.True(code == 0, output);
        Assert.Contains("exit 0", File.ReadAllText(run.Previous));
    }

    [PosixShellFact]
    public void A_new_version_that_crashes_at_startup_is_rolled_back_and_the_old_one_relaunched()
    {
        using var run = new PosixRun();
        run.WriteApp(run.Target, $"echo old-started >> '{run.Marker}'");
        run.WriteApp(run.Staged, "exit 3");

        var (code, _) = run.Run("exec", keep: "1");

        var outcome = InstallOutcomeStore.Read(run.UserData);
        Assert.Equal(1, code);
        Assert.Contains("old-started", File.ReadAllText(run.Target));
        Assert.False(File.Exists(run.Previous));
        Assert.True(outcome!.RolledBack);
        Thread.Sleep(500);
        Assert.Contains("old-started", File.ReadAllText(run.Marker.Replace('/', Path.DirectorySeparatorChar)));
    }

    [PosixShellFact]
    public void A_missing_staged_payload_restores_the_previous_version()
    {
        using var run = new PosixRun();
        run.WriteApp(run.Target, "exit 0");

        var (code, _) = run.Run("exec", keep: "1");

        Assert.Equal(1, code);
        Assert.Contains("exit 0", File.ReadAllText(run.Target));
        Assert.True(InstallOutcomeStore.Read(run.UserData)!.Failed);
    }

    private static void WriteScript(string path, string body)
    {
        File.WriteAllText(path, "#!/bin/sh\n" + body + "\n");
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
    }

    private static string Fake(PosixRun run, string name, string body)
    {
        var path = run.Temp.Sub(name);
        WriteScript(path, body);
        return HostShell.ForSh(path);
    }

    [PosixShellFact]
    public void The_macos_path_launches_with_open_and_judges_health_with_pgrep()
    {
        using var run = new PosixRun();
        Directory.CreateDirectory(run.Target);
        File.WriteAllText(Path.Combine(run.Target, "old.txt"), "old");
        Directory.CreateDirectory(run.Staged);
        File.WriteAllText(Path.Combine(run.Staged, "new.txt"), "new");
        var env = new Dictionary<string, string>
        {
            ["CODECROMA_OPEN_BIN"] = Fake(run, "open", $"echo \"open $*\" >> '{run.Marker}'"),
            ["CODECROMA_PGREP_BIN"] = Fake(run, "pgrep", "exit 0"),
        };

        var (code, output) = run.Run("mac", keep: "0", env);

        Assert.True(code == 0, output);
        Assert.True(File.Exists(Path.Combine(run.Target, "new.txt")));
        Assert.False(Directory.Exists(run.Previous));
        Assert.Single(File.ReadAllLines(run.Marker.Replace('/', Path.DirectorySeparatorChar)));
    }

    [PosixShellFact]
    public void The_macos_path_rolls_back_when_the_new_bundle_is_not_running()
    {
        using var run = new PosixRun();
        Directory.CreateDirectory(run.Target);
        File.WriteAllText(Path.Combine(run.Target, "old.txt"), "old");
        Directory.CreateDirectory(run.Staged);
        File.WriteAllText(Path.Combine(run.Staged, "new.txt"), "new");
        var env = new Dictionary<string, string>
        {
            ["CODECROMA_OPEN_BIN"] = Fake(run, "open", $"echo \"open $*\" >> '{run.Marker}'"),
            ["CODECROMA_PGREP_BIN"] = Fake(run, "pgrep", "exit 1"),
        };

        var (code, _) = run.Run("mac", keep: "0", env);

        Assert.Equal(1, code);
        Assert.True(File.Exists(Path.Combine(run.Target, "old.txt")));
        Assert.False(File.Exists(Path.Combine(run.Target, "new.txt")));
        Assert.True(InstallOutcomeStore.Read(run.UserData)!.RolledBack);
        Assert.Equal(2, File.ReadAllLines(run.Marker.Replace('/', Path.DirectorySeparatorChar)).Length);
    }

    private sealed class WindowsRun : IDisposable
    {
        public TempDir Temp { get; } = new();
        public string Target => Temp.Sub("current");
        public string Staged => Temp.Sub("current.update-1");
        public string Previous => Temp.Sub("current.previous");
        public string UserData => Temp.Dir("userdata");

        public void WriteApp(string dir, string body)
        {
            Directory.CreateDirectory(dir);
            File.WriteAllText(Path.Combine(dir, "app.cmd"), "@echo off\r\n" + body + "\r\n");
            File.WriteAllText(Path.Combine(dir, "version.txt"), Path.GetFileName(dir));
        }

        public (int ExitCode, string Output) Run(bool keepPrevious = false)
        {
            var script = Temp.Sub(UpdateScripts.WindowsName);
            File.WriteAllText(script, UpdateScripts.Windows, new UTF8Encoding(true));
            List<string> args =
            [
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-ProcessId", NoSuchPid, "-Target", Target, "-Staged", Staged,
                "-Previous", Previous, "-Exe", "app.cmd", "-ResultFile", PlatformInstaller.ResultPath(UserData), "-Version", "2.0.0", "-HealthSeconds", "2",
            ];
            if (keepPrevious) args.Add("-KeepPrevious");
            return HostShell.Run("powershell.exe", args);
        }

        public void Dispose() => Temp.Dispose();
    }

    [WindowsPowerShellFact]
    public void Windows_swaps_the_directory_and_removes_the_previous_one_after_a_healthy_start()
    {
        using var run = new WindowsRun();
        run.WriteApp(run.Target, "exit /b 0");
        run.WriteApp(run.Staged, "ping -n 6 127.0.0.1 >nul");

        var (code, output) = run.Run();

        Assert.True(code == 0, output);
        Assert.Equal("current.update-1", File.ReadAllText(Path.Combine(run.Target, "version.txt")));
        Assert.False(Directory.Exists(run.Previous));
        Assert.Equal("updated", InstallOutcomeStore.Read(run.UserData)?.Result);
    }

    [WindowsPowerShellFact]
    public void Windows_rolls_back_to_the_previous_directory_when_the_new_exe_fails_at_startup()
    {
        using var run = new WindowsRun();
        run.WriteApp(run.Target, "exit /b 0");
        run.WriteApp(run.Staged, "exit /b 3");

        var (code, _) = run.Run();

        Assert.Equal(1, code);
        Assert.Equal("current", File.ReadAllText(Path.Combine(run.Target, "version.txt")));
        Assert.False(Directory.Exists(run.Previous));
        Assert.True(InstallOutcomeStore.Read(run.UserData)!.RolledBack);
    }

    [WindowsPowerShellFact]
    public void Windows_restores_the_previous_directory_when_the_staged_one_is_missing()
    {
        using var run = new WindowsRun();
        run.WriteApp(run.Target, "exit /b 0");

        var (code, _) = run.Run();

        Assert.Equal(1, code);
        Assert.Equal("current", File.ReadAllText(Path.Combine(run.Target, "version.txt")));
        Assert.True(InstallOutcomeStore.Read(run.UserData)!.Failed);
    }

    [Theory]
    [InlineData("""{"result":"rolled-back","version":"2.0.0","detail":"x"}""", "rolled-back")]
    [InlineData("""{"result":"updated","version":"2.0.0","detail":"ok"}""", "updated")]
    [InlineData("""{"result":"weird"}""", null)]
    [InlineData("{broken", null)]
    [InlineData("[]", null)]
    public void The_result_file_is_read_defensively_and_can_be_dismissed(string json, string? expected)
    {
        using var temp = new TempDir();
        File.WriteAllText(PlatformInstaller.ResultPath(temp.Path), json);

        var outcome = InstallOutcomeStore.Read(temp.Path);
        InstallOutcomeStore.Acknowledge(temp.Path);

        Assert.Equal(expected, outcome?.Result);
        Assert.Null(InstallOutcomeStore.Read(temp.Path));
    }
}
