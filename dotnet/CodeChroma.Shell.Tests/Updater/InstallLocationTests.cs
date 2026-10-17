namespace CodeChroma.Shell.Tests.Updater;

public class InstallLocationTests
{
    private const string Home = "/home/me";
    private const string Win = @"C:\Users\me\AppData\Local";

    [Theory]
    [InlineData(ShellOs.MacOs, "/home/me/Applications/CodeChroma.app/Contents/MacOS/CodeChroma", null, null, true)]
    [InlineData(ShellOs.MacOs, "/Applications/CodeChroma.app/Contents/MacOS/CodeChroma", null, null, false)]
    [InlineData(ShellOs.MacOs, "/home/me/dev/Other.app/Contents/MacOS/x", null, null, false)]
    [InlineData(ShellOs.MacOs, "/usr/bin/codechroma", null, null, false)]
    [InlineData(ShellOs.Linux, "/opt/x", null, "/home/me/Applications/CodeChroma.AppImage", true)]
    [InlineData(ShellOs.Linux, "/opt/x", null, "/opt/CodeChroma.AppImage", false)]
    [InlineData(ShellOs.Linux, "/opt/x", null, null, false)]
    [InlineData(ShellOs.Linux, "/opt/x", null, "/home/me/../system/app.AppImage", false)]
    [InlineData(ShellOs.Windows, @"C:\Users\me\AppData\Local\Programs\CodeChroma\CodeChroma.exe", Win, null, true)]
    [InlineData(ShellOs.Windows, @"C:\Program Files\CodeChroma\CodeChroma.exe", Win, null, false)]
    [InlineData(ShellOs.Windows, @"C:\Program Files\CodeChroma\CodeChroma.exe", null, null, false)]
    public void Only_per_user_installations_may_self_update(ShellOs os, string executable, string? localAppData, string? appImage, bool allowed)
    {
        var location = new InstallLocation(os, executable, Home, localAppData, appImage);

        Assert.Equal(allowed, location.IsUserInstallation());
        if (!allowed)
            Assert.Contains("administrator privileges", Assert.Throws<UnauthorizedAccessException>(location.AssertUserInstallation).Message);
    }

    [Theory]
    [InlineData(ShellOs.MacOs, "/home/me/Applications/CodeChroma.app/Contents/MacOS/CodeChroma", null, "/home/me/Applications/CodeChroma.app")]
    [InlineData(ShellOs.Linux, "/tmp/.mount_x/AppRun", "/home/me/Applications/CodeChroma.AppImage", "/home/me/Applications/CodeChroma.AppImage")]
    [InlineData(ShellOs.Windows, @"C:\Users\me\AppData\Local\CodeChroma\current\CodeChroma.Shell.App.exe", null, "C:/Users/me/AppData/Local/CodeChroma/current")]
    [InlineData(ShellOs.Linux, "/opt/x", null, null)]
    public void The_update_target_is_the_bundle_the_appimage_or_the_app_directory(ShellOs os, string executable, string? appImage, string? expected)
    {
        var location = new InstallLocation(os, executable, Home, Win, appImage);

        Assert.Equal(expected, location.TargetPath());
    }
}
