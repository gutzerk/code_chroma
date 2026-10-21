namespace CodeChroma.Bridge.Stores;

/// <summary>Finds an executable on PATH, then in well-known install dirs (a GUI-launched app inherits a minimal PATH).</summary>
public static class CliLocator
{
    public static string? Find(string name) => Find(name, Environment.GetEnvironmentVariable("PATH") ?? "", FallbackDirs());

    public static string? Find(string name, string path, IEnumerable<string> fallbackDirs)
    {
        if (name.Length == 0) return null;
        var extensions = OperatingSystem.IsWindows()
            ? (Environment.GetEnvironmentVariable("PATHEXT") ?? ".EXE;.CMD;.BAT").Split(';', StringSplitOptions.RemoveEmptyEntries)
            : [""];
        var dirs = path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries).Concat(fallbackDirs);
        foreach (var dir in dirs)
        foreach (var extension in extensions.Prepend(""))
        {
            var candidate = Path.Combine(dir.Trim().Trim('"'), name + extension);
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    /// <summary>Where gh/claude commonly live when the process PATH lacks the user's shell additions.</summary>
    public static IReadOnlyList<string> FallbackDirs()
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (!OperatingSystem.IsWindows())
            return [Path.Combine(home, ".local", "bin"), Path.Combine(home, "bin"), Path.Combine(home, ".claude", "local"),
                Path.Combine(home, ".npm-global", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return [Path.Combine(home, ".local", "bin"), Path.Combine(home, "AppData", "Roaming", "npm"),
            Path.Combine(programFiles, "GitHub CLI"), Path.Combine(local, "Programs", "GitHub CLI")];
    }
}
