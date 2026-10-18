using System.Diagnostics;
using System.IO.Compression;
using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests.Updater;

/// <summary>Skipped unless a POSIX sh is on PATH (Linux, macOS, or Git Bash on Windows).</summary>
public sealed class PosixShellFactAttribute : FactAttribute
{
    public PosixShellFactAttribute()
    {
        if (HostShell.Sh is null) Skip = "needs a POSIX sh on PATH";
    }
}

/// <summary>Skipped off Windows, where the PowerShell swap helper cannot run.</summary>
public sealed class WindowsPowerShellFactAttribute : FactAttribute
{
    public WindowsPowerShellFactAttribute()
    {
        if (!OperatingSystem.IsWindows()) Skip = "needs Windows PowerShell";
    }
}

public static class HostShell
{
    public static string? Sh { get; } = Find(OperatingSystem.IsWindows() ? ["sh.exe"] : ["sh"]);

    /// <summary>msys sh accepts C:/dir but not always C:\dir.</summary>
    public static string ForSh(string path) => path.Replace('\\', '/');

    private static string? Find(string[] names) =>
        (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
            .SelectMany(dir => names.Select(n => Path.Combine(dir, n)))
            .FirstOrDefault(File.Exists);

    public static (int ExitCode, string Output) Run(string file, IEnumerable<string> args, IDictionary<string, string>? env = null, int timeoutSeconds = 90)
    {
        var info = new ProcessStartInfo(file) { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var arg in args) info.ArgumentList.Add(arg);
        foreach (var (key, value) in env ?? new Dictionary<string, string>()) info.Environment[key] = value;
        using var process = Process.Start(info)!;
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit(timeoutSeconds * 1000))
        {
            process.Kill(entireProcessTree: true);
            throw new TimeoutException($"{file} did not finish in {timeoutSeconds}s");
        }
        return (process.ExitCode, output.Result + error.Result);
    }
}

public sealed class RecordingLauncher : IHelperLauncher
{
    public List<HelperLaunch> Launches { get; } = [];

    public void StartDetached(HelperLaunch launch) => Launches.Add(launch);
}

public static class Zips
{
    public static string Make(string path, IReadOnlyDictionary<string, string> entries)
    {
        using var stream = File.Create(path);
        using var zip = new ZipArchive(stream, ZipArchiveMode.Create);
        foreach (var (name, content) in entries)
        {
            using var writer = new StreamWriter(zip.CreateEntry(name).Open());
            writer.Write(content);
        }
        return path;
    }
}

/// <summary>A fake per-user install of one OS on a temp directory, plus a downloaded package for it.</summary>
public sealed class InstallScenario : IDisposable
{
    public const string WindowsExe = "CodeChroma.Shell.App.exe";

    public TempDir Temp { get; } = new();
    public ShellOs Os { get; }
    public string Home { get; }
    public string UserData { get; }
    public string Target { get; private set; } = "";
    public InstallLocation Location { get; private set; } = null!;
    public ShellPlatform Platform => new(Os, ShellArch.X64);

    public InstallScenario(ShellOs os)
    {
        Os = os;
        Home = Temp.Dir("home");
        UserData = Temp.Dir("userdata");
        var local = Temp.Dir("home", "AppData", "Local");
        switch (os)
        {
            case ShellOs.Windows:
                Target = Temp.Dir("home", "AppData", "Local", "CodeChroma", "current");
                File.WriteAllText(Path.Combine(Target, WindowsExe), "old exe");
                Location = new InstallLocation(os, Path.Combine(Target, WindowsExe), Home, local, null);
                break;
            case ShellOs.MacOs:
                Target = Temp.Dir("home", "Applications", "CodeChroma.app");
                Directory.CreateDirectory(Path.Combine(Target, "Contents", "MacOS"));
                File.WriteAllText(Path.Combine(Target, "Contents", "MacOS", "CodeChroma"), "old exe");
                Location = new InstallLocation(os, Path.Combine(Target, "Contents", "MacOS", "CodeChroma"), Home, null, null);
                break;
            default:
                Target = Path.Combine(Temp.Dir("home", "Applications"), "CodeChroma.AppImage");
                File.WriteAllText(Target, "old appimage");
                Location = new InstallLocation(os, "/tmp/.mount_x/AppRun", Home, null, Target);
                break;
        }
    }

    public string AssetName => Os switch
    {
        ShellOs.Windows => "CodeChroma-2.0.0-win-x64.zip",
        ShellOs.MacOs => "CodeChroma-2.0.0-osx-x64.zip",
        _ => "CodeChroma-2.0.0-linux-x86_64.AppImage",
    };

    /// <summary>The default package holds what Velopack builds: current/ for Windows, the .app for macOS, the file itself for Linux.</summary>
    public UpdateInfo Package(IReadOnlyDictionary<string, string>? zipEntries = null, string? assetName = null)
    {
        var name = assetName ?? AssetName;
        var path = Temp.Sub(name);
        if (name.EndsWith(".zip"))
            Zips.Make(path, zipEntries ?? (Os == ShellOs.Windows
                ? new Dictionary<string, string> { [".portable"] = "", ["CodeChroma.exe"] = "stub", [$"current/{WindowsExe}"] = "new exe", ["current/lib.dll"] = "dll" }
                : new Dictionary<string, string> { ["CodeChroma.app/Contents/MacOS/CodeChroma"] = "new exe", ["CodeChroma.app/Contents/Info.plist"] = "plist" }));
        else File.WriteAllText(path, "new appimage");
        return new UpdateInfo("v2.0.0", name, path, new string('a', 64), $"https://github.com/gutzerk/code_chroma/releases/download/v2.0.0/{name}", null);
    }

    public PlatformInstaller Installer(RecordingLauncher launcher, int pid = 4242, IArchiveExtractor? extractor = null) =>
        new(Location, Platform, UserData, launcher, extractor ?? new ZipArchiveExtractor(), scriptDir: Temp.Dir("scripts"), processId: pid, healthSeconds: 2);

    public void Dispose() => Temp.Dispose();
}
