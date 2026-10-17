using System.Text.Json;

namespace CodeChroma.Shell;

public sealed record ElectronInstall(string? AppPath, string? Uninstaller, string UserDataDir, bool HasUserData);

public sealed record MigrationReport(bool AlreadyDone, bool SharedDirectory, IReadOnlyList<string> Copied, IReadOnlyList<string> KeptExisting);

/// <summary>One-time move of an installed Electron copy to the C# app: finds the old install and imports its userData without touching it.</summary>
public static class ElectronMigration
{
    public const string MarkerFileName = "electron-migrated.json";

    /// <summary>Electron's userData for productName CodeChroma; the C# app should use the same directory so nothing needs copying.</summary>
    public static string ElectronUserDataDir(ShellOs os, string home, string? appData, string? xdgConfigHome) => os switch
    {
        ShellOs.Windows => Path.Combine(appData ?? Path.Combine(home, "AppData", "Roaming"), "CodeChroma"),
        ShellOs.MacOs => Path.Combine(home, "Library", "Application Support", "CodeChroma"),
        _ => Path.Combine(string.IsNullOrEmpty(xdgConfigHome) ? Path.Combine(home, ".config") : xdgConfigHome, "CodeChroma"),
    };

    public static ElectronInstall Detect(ShellOs os, string home, string? localAppData, string? appData, string? xdgConfigHome)
    {
        var userData = ElectronUserDataDir(os, home, appData, xdgConfigHome);
        string? app = null, uninstaller = null;
        if (os == ShellOs.Windows && localAppData is not null)
        {
            var dir = Path.Combine(localAppData, "Programs", "CodeChroma");
            if (File.Exists(Path.Combine(dir, "CodeChroma.exe")))
            {
                app = dir;
                var candidate = Path.Combine(dir, "Uninstall CodeChroma.exe");
                uninstaller = File.Exists(candidate) ? candidate : null;
            }
        }
        else if (os == ShellOs.MacOs)
        {
            var bundle = Path.Combine(home, "Applications", "CodeChroma.app");
            if (Directory.Exists(Path.Combine(bundle, "Contents", "Frameworks", "Electron Framework.framework"))) app = bundle;
        }
        return new ElectronInstall(app, uninstaller, userData, Directory.Exists(userData));
    }

    /// <summary>The silent per-user NSIS uninstall; null where the C# install replaces the Electron one in place (macOS bundle, Linux AppImage).</summary>
    public static HelperLaunch? RemovalFor(ElectronInstall install) =>
        install.Uninstaller is { } exe ? new HelperLaunch(exe, ["/currentuser", "/S"]) : null;

    /// <summary>Copies the portable state (top-level JSON files and the tutorial project) once; existing files in the target always win and the source is never modified.</summary>
    public static MigrationReport ImportUserData(string sourceDir, string targetDir)
    {
        if (SamePath(sourceDir, targetDir)) return new MigrationReport(false, true, [], []);
        var marker = Path.Combine(targetDir, MarkerFileName);
        if (File.Exists(marker)) return new MigrationReport(true, false, [], []);
        if (!Directory.Exists(sourceDir)) return new MigrationReport(false, false, [], []);

        Directory.CreateDirectory(targetDir);
        var copied = new List<string>();
        var kept = new List<string>();
        foreach (var file in Directory.EnumerateFiles(sourceDir, "*.json").Select(Path.GetFileName).OfType<string>().Order(StringComparer.Ordinal))
            CopyFile(Path.Combine(sourceDir, file), Path.Combine(targetDir, file), file, copied, kept);
        var tutorial = Path.Combine(sourceDir, "codechroma-tutorial");
        if (Directory.Exists(tutorial)) CopyTree(tutorial, Path.Combine(targetDir, "codechroma-tutorial"), "codechroma-tutorial", copied, kept);

        File.WriteAllText(marker, JsonSerializer.Serialize(new { migratedFrom = sourceDir, copied, keptExisting = kept }));
        return new MigrationReport(false, false, copied, kept);
    }

    private static void CopyTree(string source, string target, string label, List<string> copied, List<string> kept)
    {
        Directory.CreateDirectory(target);
        foreach (var file in Directory.EnumerateFiles(source))
            CopyFile(file, Path.Combine(target, Path.GetFileName(file)), $"{label}/{Path.GetFileName(file)}", copied, kept);
        foreach (var dir in Directory.EnumerateDirectories(source))
            CopyTree(dir, Path.Combine(target, Path.GetFileName(dir)), $"{label}/{Path.GetFileName(dir)}", copied, kept);
    }

    private static void CopyFile(string source, string target, string label, List<string> copied, List<string> kept)
    {
        if (File.Exists(target)) { kept.Add(label); return; }
        File.Copy(source, target);
        copied.Add(label);
    }

    private static bool SamePath(string a, string b) =>
        string.Equals(Path.GetFullPath(a).TrimEnd(Path.DirectorySeparatorChar), Path.GetFullPath(b).TrimEnd(Path.DirectorySeparatorChar),
            OperatingSystem.IsLinux() ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase);
}
