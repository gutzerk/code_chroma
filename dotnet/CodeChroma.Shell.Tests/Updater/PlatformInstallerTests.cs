namespace CodeChroma.Shell.Tests.Updater;

public class PlatformInstallerTests
{
    [Theory]
    [InlineData(ShellOs.Windows)]
    [InlineData(ShellOs.MacOs)]
    [InlineData(ShellOs.Linux)]
    public async Task Stages_beside_the_install_and_leaves_the_swap_to_a_detached_helper(ShellOs os)
    {
        using var scenario = new InstallScenario(os);
        var launcher = new RecordingLauncher();
        var info = scenario.Package();

        var exitNow = await scenario.Installer(launcher).InstallAsync(info);

        Assert.True(exitNow);
        Assert.True(Directory.Exists($"{scenario.Target}.update-4242") || File.Exists($"{scenario.Target}.update-4242"));
        Assert.False(File.Exists(info.DownloadPath));
        var args = Assert.Single(launcher.Launches).Arguments.Select(Slashes).ToList();
        Assert.Contains(Slashes($"{scenario.Target}.update-4242"), args);
        Assert.Contains(Slashes($"{scenario.Target}.previous"), args);
        Assert.Contains("4242", args);
        Assert.Contains("2.0.0", args);
        Assert.Contains(Slashes(Path.Combine(scenario.UserData, "update-result.json")), args);
    }

    private static string Slashes(string path) => path.Replace('\\', '/');

    [Fact]
    public async Task The_install_itself_is_not_touched_before_the_helper_runs()
    {
        using var scenario = new InstallScenario(ShellOs.Windows);

        await scenario.Installer(new RecordingLauncher()).InstallAsync(scenario.Package());

        Assert.Equal("old exe", await File.ReadAllTextAsync(Path.Combine(scenario.Target, InstallScenario.WindowsExe)));
        Assert.False(Directory.Exists($"{scenario.Target}.previous"));
    }

    [Fact]
    public async Task Windows_uses_the_current_folder_of_the_velopack_package_and_a_hidden_powershell()
    {
        using var scenario = new InstallScenario(ShellOs.Windows);
        var launcher = new RecordingLauncher();

        await scenario.Installer(launcher).InstallAsync(scenario.Package());

        var staged = $"{scenario.Target}.update-4242";
        Assert.Equal("new exe", await File.ReadAllTextAsync(Path.Combine(staged, InstallScenario.WindowsExe)));
        Assert.True(File.Exists(Path.Combine(staged, "lib.dll")));
        Assert.False(File.Exists(Path.Combine(staged, "Update.exe")));
        var launch = launcher.Launches.Single();
        Assert.Equal("powershell.exe", launch.FileName);
        Assert.Contains("-File", launch.Arguments);
        Assert.Equal(InstallScenario.WindowsExe, launch.Arguments[launch.Arguments.ToList().IndexOf("-Exe") + 1]);
    }

    [Fact]
    public async Task Windows_accepts_a_flat_zip_whose_root_is_the_app()
    {
        using var scenario = new InstallScenario(ShellOs.Windows);
        var flat = new Dictionary<string, string> { [InstallScenario.WindowsExe] = "flat exe" };

        await scenario.Installer(new RecordingLauncher()).InstallAsync(scenario.Package(flat));

        Assert.Equal("flat exe", await File.ReadAllTextAsync(Path.Combine($"{scenario.Target}.update-4242", InstallScenario.WindowsExe)));
    }

    [Fact]
    public async Task MacOS_stages_the_app_bundle_and_asks_the_helper_for_open_and_a_pgrep_health_check()
    {
        using var scenario = new InstallScenario(ShellOs.MacOs);
        var launcher = new RecordingLauncher();

        await scenario.Installer(launcher).InstallAsync(scenario.Package());

        Assert.Equal("new exe", await File.ReadAllTextAsync(Path.Combine($"{scenario.Target}.update-4242", "Contents", "MacOS", "CodeChroma")));
        var args = launcher.Launches.Single().Arguments;
        Assert.Equal(("/bin/sh", "mac", "0"), (launcher.Launches.Single().FileName, args[args.ToList().IndexOf("4242") + 1], args[^1]));
    }

    [Fact]
    public async Task Linux_stages_the_appimage_and_keeps_the_previous_one()
    {
        using var scenario = new InstallScenario(ShellOs.Linux);
        var launcher = new RecordingLauncher();

        await scenario.Installer(launcher).InstallAsync(scenario.Package());

        var staged = $"{scenario.Target}.update-4242";
        Assert.Equal("new appimage", await File.ReadAllTextAsync(staged));
        var args = launcher.Launches.Single().Arguments;
        Assert.Equal(("exec", "1"), (args[args.ToList().IndexOf("4242") + 1], args[^1]));
        if (!OperatingSystem.IsWindows()) Assert.True(File.GetUnixFileMode(staged).HasFlag(UnixFileMode.UserExecute));
    }

    [Theory]
    [InlineData(ShellOs.Windows, "no-exe.zip")]
    [InlineData(ShellOs.MacOs, "no-app.zip")]
    public async Task A_package_without_the_app_is_refused_and_nothing_is_left_behind(ShellOs os, string label)
    {
        using var scenario = new InstallScenario(os);
        var launcher = new RecordingLauncher();
        var info = scenario.Package(new Dictionary<string, string> { ["readme.txt"] = label });

        await Assert.ThrowsAsync<InvalidDataException>(() => scenario.Installer(launcher).InstallAsync(info));

        Assert.Empty(launcher.Launches);
        Assert.Empty(Directory.GetFileSystemEntries(Path.GetDirectoryName(scenario.Target)!, "*update*"));
        Assert.True(Directory.Exists(scenario.Target));
    }

    [Fact]
    public async Task A_zip_entry_that_escapes_the_extraction_directory_is_refused()
    {
        using var scenario = new InstallScenario(ShellOs.Windows);
        var launcher = new RecordingLauncher();
        var info = scenario.Package(new Dictionary<string, string> { ["../../evil.txt"] = "x", [$"current/{InstallScenario.WindowsExe}"] = "new" });

        var error = await Assert.ThrowsAsync<InvalidDataException>(() => scenario.Installer(launcher).InstallAsync(info));

        Assert.Contains("escapes", error.Message);
        Assert.Empty(launcher.Launches);
        Assert.False(File.Exists(Path.Combine(Path.GetDirectoryName(scenario.Target)!, "..", "evil.txt")));
    }

    [Fact]
    public async Task A_system_wide_install_is_refused_before_anything_is_staged()
    {
        using var scenario = new InstallScenario(ShellOs.Linux);
        var system = new InstallLocation(ShellOs.Linux, "/opt/x", scenario.Home, null, "/opt/CodeChroma.AppImage");
        var installer = new PlatformInstaller(system, scenario.Platform, scenario.UserData, new RecordingLauncher(), processId: 1);

        var error = await Assert.ThrowsAsync<UnauthorizedAccessException>(() => installer.InstallAsync(scenario.Package()));

        Assert.Contains("administrator privileges", error.Message);
    }

    [Theory]
    [InlineData("v2.0.0; rm -rf ~")]
    [InlineData("v2.0.0 && x")]
    [InlineData("$(id)")]
    public async Task A_version_string_that_could_inject_into_the_helper_is_refused(string version)
    {
        using var scenario = new InstallScenario(ShellOs.Linux);
        var info = scenario.Package() with { Version = version };

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => scenario.Installer(new RecordingLauncher()).InstallAsync(info));

        Assert.Contains("unsafe version", error.Message);
    }

    [Theory]
    [InlineData(ShellOs.MacOs)]
    [InlineData(ShellOs.Linux)]
    public async Task The_written_posix_helper_has_no_carriage_returns_a_shell_would_choke_on(ShellOs os)
    {
        using var scenario = new InstallScenario(os);
        var launcher = new RecordingLauncher();

        await scenario.Installer(launcher).InstallAsync(scenario.Package());

        var script = await File.ReadAllTextAsync(launcher.Launches.Single().Arguments.Single(a => a.EndsWith(UpdateScripts.PosixName)));
        Assert.DoesNotContain('\r', script);
        Assert.StartsWith("#!/bin/sh", script);
    }
}
