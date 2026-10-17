using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests.Updater;

public class ElectronMigrationTests
{
    [Theory]
    [InlineData(ShellOs.Windows, "/roam", null, "/roam/CodeChroma")]
    [InlineData(ShellOs.Windows, null, null, "/h/AppData/Roaming/CodeChroma")]
    [InlineData(ShellOs.MacOs, null, null, "/h/Library/Application Support/CodeChroma")]
    [InlineData(ShellOs.Linux, null, null, "/h/.config/CodeChroma")]
    [InlineData(ShellOs.Linux, null, "/cfg", "/cfg/CodeChroma")]
    public void Electron_user_data_lives_in_the_per_os_default_directory(ShellOs os, string? appData, string? xdg, string expected)
    {
        var dir = ElectronMigration.ElectronUserDataDir(os, "/h", appData, xdg);

        Assert.Equal(expected, dir.Replace('\\', '/'));
    }

    private static string SeedUserData(TempDir temp, string name = "electron")
    {
        var dir = temp.Dir(name);
        File.WriteAllText(Path.Combine(dir, "recent.json"), """[{"path":"/r","name":"r","openedAt":1}]""");
        File.WriteAllText(Path.Combine(dir, "update-settings.json"), """{"skippedVersion":"1.2.3","autoDownload":true}""");
        File.WriteAllText(Path.Combine(dir, "update-cache.json"), """{"latestVersion":"v1.2.3"}""");
        Directory.CreateDirectory(Path.Combine(dir, "Local Storage", "leveldb"));
        File.WriteAllText(Path.Combine(dir, "Local Storage", "leveldb", "000003.log"), "chromium");
        File.WriteAllText(Path.Combine(dir, "Preferences"), "chromium");
        Directory.CreateDirectory(Path.Combine(dir, "codechroma-tutorial", "backend"));
        File.WriteAllText(Path.Combine(dir, "codechroma-tutorial", "backend", "service.py"), "x = 1");
        return dir;
    }

    [Fact]
    public void Imports_recents_update_settings_and_the_tutorial_but_not_chromium_internals()
    {
        using var temp = new TempDir();
        var source = SeedUserData(temp);
        var target = temp.Sub("csharp");

        var report = ElectronMigration.ImportUserData(source, target);

        Assert.Equal(["recent.json", "update-cache.json", "update-settings.json", "codechroma-tutorial/backend/service.py"], report.Copied);
        Assert.Equal("""{"skippedVersion":"1.2.3","autoDownload":true}""", File.ReadAllText(Path.Combine(target, "update-settings.json")));
        Assert.Equal(new UpdateSettings("1.2.3", true), UpdateSettingsStore.Read(UpdateSettingsStore.PathIn(target)));
        Assert.Equal("/r", Assert.Single(RecentRepos.Read(RecentRepos.StorePath(target))).Path);
        Assert.False(Directory.Exists(Path.Combine(target, "Local Storage")));
        Assert.False(File.Exists(Path.Combine(target, "Preferences")));
    }

    [Fact]
    public void The_electron_copy_is_never_modified_so_it_still_works_if_the_user_goes_back()
    {
        using var temp = new TempDir();
        var source = SeedUserData(temp);
        var before = Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories).Order().ToList();

        ElectronMigration.ImportUserData(source, temp.Sub("csharp"));

        Assert.Equal(before, Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories).Order().ToList());
    }

    [Fact]
    public void Existing_files_in_the_target_win_and_a_second_run_does_nothing()
    {
        using var temp = new TempDir();
        var source = SeedUserData(temp);
        var target = temp.Dir("csharp");
        File.WriteAllText(Path.Combine(target, "recent.json"), "[]");

        var first = ElectronMigration.ImportUserData(source, target);
        File.Delete(Path.Combine(target, "update-settings.json"));
        var second = ElectronMigration.ImportUserData(source, target);

        Assert.Contains("recent.json", first.KeptExisting);
        Assert.Equal("[]", File.ReadAllText(Path.Combine(target, "recent.json")));
        Assert.True(second.AlreadyDone);
        Assert.False(File.Exists(Path.Combine(target, "update-settings.json")));
    }

    [Fact]
    public void Sharing_the_electron_directory_needs_no_copy_at_all()
    {
        using var temp = new TempDir();
        var source = SeedUserData(temp);

        var report = ElectronMigration.ImportUserData(source, source + Path.DirectorySeparatorChar);

        Assert.True(report.SharedDirectory);
        Assert.False(File.Exists(Path.Combine(source, ElectronMigration.MarkerFileName)));
    }

    [Fact]
    public void A_machine_that_never_had_electron_imports_nothing()
    {
        using var temp = new TempDir();

        var report = ElectronMigration.ImportUserData(temp.Sub("missing"), temp.Sub("csharp"));

        Assert.Empty(report.Copied);
        Assert.False(Directory.Exists(temp.Sub("csharp")));
    }

    [Fact]
    public void Detects_a_windows_nsis_install_and_plans_a_silent_per_user_uninstall()
    {
        using var temp = new TempDir();
        var local = temp.Dir("Local");
        var dir = Directory.CreateDirectory(Path.Combine(local, "Programs", "CodeChroma")).FullName;
        File.WriteAllText(Path.Combine(dir, "CodeChroma.exe"), "x");
        File.WriteAllText(Path.Combine(dir, "Uninstall CodeChroma.exe"), "x");

        var install = ElectronMigration.Detect(ShellOs.Windows, temp.Path, local, temp.Dir("Roaming"), null);
        var removal = ElectronMigration.RemovalFor(install);

        Assert.Equal(dir, install.AppPath);
        Assert.Equal(new HelperLaunch(Path.Combine(dir, "Uninstall CodeChroma.exe"), ["/currentuser", "/S"]), removal, new LaunchComparer());
    }

    [Fact]
    public void Detects_an_electron_bundle_on_macos_but_not_a_csharp_one()
    {
        using var temp = new TempDir();
        var app = Path.Combine(temp.Dir("Applications", "CodeChroma.app", "Contents", "MacOS"), "CodeChroma");
        File.WriteAllText(app, "x");

        var csharp = ElectronMigration.Detect(ShellOs.MacOs, temp.Path, null, null, null);
        Directory.CreateDirectory(Path.Combine(temp.Path, "Applications", "CodeChroma.app", "Contents", "Frameworks", "Electron Framework.framework"));
        var electron = ElectronMigration.Detect(ShellOs.MacOs, temp.Path, null, null, null);

        Assert.Null(csharp.AppPath);
        Assert.NotNull(electron.AppPath);
        Assert.Null(ElectronMigration.RemovalFor(electron));
    }

    private sealed class LaunchComparer : IEqualityComparer<HelperLaunch?>
    {
        public bool Equals(HelperLaunch? x, HelperLaunch? y) => x?.FileName == y?.FileName && x!.Arguments.SequenceEqual(y!.Arguments);

        public int GetHashCode(HelperLaunch? obj) => obj?.FileName.GetHashCode() ?? 0;
    }
}
