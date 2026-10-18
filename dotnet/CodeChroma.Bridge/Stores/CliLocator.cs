namespace CodeChroma.Bridge.Stores;

/// <summary>Finds an executable on PATH (the part of runtime_env's lookup that needs no login-shell capture).</summary>
public static class CliLocator
{
    public static string? Find(string name)
    {
        if (name.Length == 0) return null;
        var extensions = OperatingSystem.IsWindows()
            ? (Environment.GetEnvironmentVariable("PATHEXT") ?? ".EXE;.CMD;.BAT").Split(';', StringSplitOptions.RemoveEmptyEntries)
            : [""];
        foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        foreach (var extension in extensions.Prepend(""))
        {
            var candidate = Path.Combine(dir.Trim('"'), name + extension);
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }
}
