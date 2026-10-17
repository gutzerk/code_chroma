using System.Diagnostics;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace CodeChroma.Shell;

public interface IArchiveExtractor
{
    void Extract(string archivePath, string destinationDir);
}

/// <summary>Managed zip extraction with a zip-slip guard; fine for Windows payloads, which hold no symlinks or unix modes.</summary>
public sealed class ZipArchiveExtractor : IArchiveExtractor
{
    public void Extract(string archivePath, string destinationDir)
    {
        var root = Path.GetFullPath(destinationDir) + Path.DirectorySeparatorChar;
        Directory.CreateDirectory(destinationDir);
        using var zip = ZipFile.OpenRead(archivePath);
        foreach (var entry in zip.Entries)
        {
            var target = Path.GetFullPath(Path.Combine(destinationDir, entry.FullName));
            if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase) && target + Path.DirectorySeparatorChar != root)
                throw new InvalidDataException($"update package entry escapes the extraction directory: {entry.FullName}");
            if (entry.FullName.EndsWith('/') || entry.FullName.EndsWith('\\'))
            {
                Directory.CreateDirectory(target);
                continue;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            entry.ExtractToFile(target, overwrite: true);
        }
    }
}

/// <summary>macOS extraction through ditto, which keeps the symlinks, unix modes and resource forks an .app bundle needs.</summary>
public sealed class DittoArchiveExtractor : IArchiveExtractor
{
    public void Extract(string archivePath, string destinationDir)
    {
        Directory.CreateDirectory(destinationDir);
        var info = new ProcessStartInfo("/usr/bin/ditto") { UseShellExecute = false, RedirectStandardError = true };
        foreach (var arg in new[] { "-x", "-k", archivePath, destinationDir }) info.ArgumentList.Add(arg);
        using var process = Process.Start(info) ?? throw new InvalidOperationException("could not start ditto");
        var error = process.StandardError.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0) throw new InvalidOperationException($"ditto failed to extract the update package: {error.Trim()}");
    }
}

public sealed record HelperLaunch(string FileName, IReadOnlyList<string> Arguments);

public interface IHelperLauncher
{
    void StartDetached(HelperLaunch launch);
}

/// <summary>Starts the swap helper so it outlives this process (nohup on POSIX, a hidden PowerShell on Windows).</summary>
public sealed class ProcessHelperLauncher : IHelperLauncher
{
    public void StartDetached(HelperLaunch launch)
    {
        var info = new ProcessStartInfo(launch.FileName) { UseShellExecute = false, CreateNoWindow = true };
        foreach (var arg in launch.Arguments) info.ArgumentList.Add(arg);
        Process.Start(info)?.Dispose();
    }
}

/// <summary>Stages the downloaded package next to the install, then hands the swap to a detached helper that can roll back.</summary>
public sealed partial class PlatformInstaller(
    InstallLocation location,
    ShellPlatform platform,
    string userDataDir,
    IHelperLauncher launcher,
    IArchiveExtractor? extractor = null,
    string? scriptDir = null,
    int? processId = null,
    int healthSeconds = 8)
{
    public const string ResultFileName = "update-result.json";

    [GeneratedRegex(@"^[0-9A-Za-z.+-]+$")]
    private static partial Regex SafeVersion();

    public static string ResultPath(string userDataDir) => Path.Combine(userDataDir, ResultFileName);

    public Task<bool> InstallAsync(UpdateInfo info, CancellationToken ct = default)
    {
        var plan = InstallPlanner.For(platform);
        if (info.Kind != AssetKind.Native)
            throw new InvalidOperationException($"This release only carries the Electron installer ({info.AssetName}); install it manually from GitHub Releases.");
        location.AssertUserInstallation();
        var version = info.Version.TrimStart('v');
        if (!SafeVersion().IsMatch(version)) throw new InvalidOperationException($"refusing to apply an update with an unsafe version string: {info.Version}");
        var target = location.TargetPath() ?? throw new InvalidOperationException("cannot locate the installed application to replace");
        var pid = processId ?? Environment.ProcessId;
        var staged = $"{target}.update-{pid}";
        var previous = $"{target}.previous";

        try
        {
            Stage(plan.Kind, info.DownloadPath, staged);
            launcher.StartDetached(BuildLaunch(plan.Kind, pid, target, staged, previous, version));
        }
        catch
        {
            DeletePath(staged);
            DeletePath(staged + ".x");
            throw;
        }
        TryDelete(info.DownloadPath);
        return Task.FromResult(plan.ExitForHelper);
    }

    private void Stage(InstallKind kind, string package, string staged)
    {
        DeletePath(staged);
        switch (kind)
        {
            case InstallKind.LinuxAppImageReplace:
                File.Copy(package, staged, overwrite: true);
                if (!OperatingSystem.IsWindows())
                    File.SetUnixFileMode(staged, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.GroupRead | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
                break;
            case InstallKind.MacSwap:
                StageMac(package, staged);
                break;
            case InstallKind.WindowsSwap:
                StageWindows(package, staged);
                break;
            default:
                throw new NotSupportedException($"{kind} is not an install path of this updater");
        }
    }

    private void StageMac(string package, string staged)
    {
        var scratch = staged + ".x";
        DeletePath(scratch);
        (extractor ?? new DittoArchiveExtractor()).Extract(package, scratch);
        var bundle = Directory.EnumerateDirectories(scratch, "*.app").FirstOrDefault()
            ?? throw new InvalidDataException("the update package does not contain an .app bundle");
        if (!Directory.Exists(Path.Combine(bundle, "Contents", "MacOS"))) throw new InvalidDataException("the update bundle has no Contents/MacOS directory");
        Directory.Move(bundle, staged);
        DeletePath(scratch);
    }

    private void StageWindows(string package, string staged)
    {
        var scratch = staged + ".x";
        DeletePath(scratch);
        (extractor ?? new ZipArchiveExtractor()).Extract(package, scratch);
        var inner = Path.Combine(scratch, "current");
        var payload = Directory.Exists(inner) ? inner : scratch;
        var exe = LastSegment(location.Executable);
        if (!File.Exists(Path.Combine(payload, exe))) throw new InvalidDataException($"the update package does not contain {exe}");
        Directory.Move(payload, staged);
        DeletePath(scratch);
    }

    private HelperLaunch BuildLaunch(InstallKind kind, int pid, string target, string staged, string previous, string version)
    {
        var dir = scriptDir ?? Path.GetTempPath();
        Directory.CreateDirectory(dir);
        var result = ResultPath(userDataDir);
        if (kind == InstallKind.WindowsSwap)
        {
            var script = Path.Combine(dir, $"{pid}-{UpdateScripts.WindowsName}");
            File.WriteAllText(script, UpdateScripts.Windows, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
            return new HelperLaunch("powershell.exe",
            [
                "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", script,
                "-ProcessId", pid.ToString(), "-Target", target, "-Staged", staged, "-Previous", previous,
                "-Exe", LastSegment(location.Executable), "-ResultFile", result, "-Version", version, "-HealthSeconds", healthSeconds.ToString(),
            ]);
        }

        var posix = Path.Combine(dir, $"{pid}-{UpdateScripts.PosixName}");
        File.WriteAllText(posix, UpdateScripts.Posix.Replace("\r\n", "\n"), new UTF8Encoding(false));
        var mode = kind == InstallKind.MacSwap ? "mac" : "exec";
        var keep = kind == InstallKind.LinuxAppImageReplace ? "1" : "0";
        return new HelperLaunch("/bin/sh",
        [
            "-c", "nohup sh \"$@\" >/dev/null 2>&1 &", "sh", posix,
            pid.ToString(), mode, target, staged, previous, result, version, healthSeconds.ToString(), keep,
        ]);
    }

    private static string LastSegment(string path) => path.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries).LastOrDefault() ?? path;

    private static void DeletePath(string path)
    {
        try
        {
            if (Directory.Exists(path)) Directory.Delete(path, recursive: true);
            else if (File.Exists(path)) File.Delete(path);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }

    private static void TryDelete(string path)
    {
        try { File.Delete(path); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }
}

public sealed record InstallOutcome(string Result, string Version, string Detail)
{
    public bool RolledBack => Result == "rolled-back";
    public bool Failed => Result == "failed";
}

/// <summary>Reads the result file the swap helper leaves behind, so the next launch can tell the user what happened.</summary>
public static class InstallOutcomeStore
{
    public static InstallOutcome? Read(string userDataDir)
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(PlatformInstaller.ResultPath(userDataDir)));
            var root = doc.RootElement;
            string? Get(string name) => root.ValueKind == JsonValueKind.Object && root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
            return Get("result") is { } result && result is "updated" or "rolled-back" or "failed"
                ? new InstallOutcome(result, Get("version") ?? "", Get("detail") ?? "")
                : null;
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    public static void Acknowledge(string userDataDir)
    {
        try { File.Delete(PlatformInstaller.ResultPath(userDataDir)); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }
}
