namespace CodeChroma.Shell;

/// <summary>Where the shell keeps per-user data (same place Electron used) and small launch-time parsing.</summary>
public static class AppPaths
{
    public const string ProductName = "CodeChroma";

    public static string UserDataDir(ShellOs os, string home, string appData, string? xdgConfigHome) => os switch
    {
        ShellOs.Windows => $"{appData}/{ProductName}",
        ShellOs.MacOs => $"{home}/Library/Application Support/{ProductName}",
        _ => $"{(string.IsNullOrEmpty(xdgConfigHome) ? appData : xdgConfigHome)}/{ProductName}",
    };

    public static string CurrentUserDataDir() => UserDataDir(
        ShellPlatform.Current.Os,
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        Environment.GetEnvironmentVariable("XDG_CONFIG_HOME"));

    public static string DisplayVersion(string? informational)
    {
        if (string.IsNullOrWhiteSpace(informational)) return "";
        var plus = informational.IndexOf('+');
        return plus < 0 ? informational : informational[..plus];
    }

    public static string? RepoFromArgs(string[] args)
    {
        var index = Array.IndexOf(args, "--repo");
        return index < 0 || index + 1 >= args.Length ? null : args[index + 1];
    }
}
