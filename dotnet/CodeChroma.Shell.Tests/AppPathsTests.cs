namespace CodeChroma.Shell.Tests;

public class AppPathsTests
{
    [Theory]
    [InlineData(ShellOs.Windows, "C:\\Users\\me", "C:\\Users\\me\\AppData\\Roaming", null, "C:\\Users\\me\\AppData\\Roaming/CodeChroma")]
    [InlineData(ShellOs.MacOs, "/Users/me", "/Users/me/.config", null, "/Users/me/Library/Application Support/CodeChroma")]
    [InlineData(ShellOs.Linux, "/home/me", "/home/me/.config", null, "/home/me/.config/CodeChroma")]
    [InlineData(ShellOs.Linux, "/home/me", "/home/me/.config", "/xdg", "/xdg/CodeChroma")]
    public void User_data_lives_in_the_per_os_default_directory(ShellOs os, string home, string appData, string? xdg, string expected)
    {
        var dir = AppPaths.UserDataDir(os, home, appData, xdg);

        Assert.Equal(expected, dir);
    }

    [Theory]
    [InlineData("0.12.1+abc123", "0.12.1")]
    [InlineData("1.0.0-beta.1+sha", "1.0.0-beta.1")]
    [InlineData("0.12.1", "0.12.1")]
    [InlineData(null, "")]
    public void The_displayed_version_drops_build_metadata(string? informational, string expected)
    {
        var version = AppPaths.DisplayVersion(informational);

        Assert.Equal(expected, version);
    }

    [Theory]
    [InlineData(new[] { "--repo", "/work/atlas" }, "/work/atlas")]
    [InlineData(new[] { "--repo" }, null)]
    [InlineData(new string[0], null)]
    [InlineData(new[] { "--other", "x", "--repo", "r" }, "r")]
    public void A_repo_argument_skips_the_launcher(string[] args, string? expected)
    {
        var repo = AppPaths.RepoFromArgs(args);

        Assert.Equal(expected, repo);
    }
}
