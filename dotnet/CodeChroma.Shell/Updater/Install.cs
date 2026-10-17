namespace CodeChroma.Shell;

/// <summary>WindowsSetup is the Electron NSIS path, kept for reference; the C# app uses WindowsSwap (side-by-side with rollback).</summary>
public enum InstallKind { MacSwap, WindowsSetup, LinuxAppImageReplace, WindowsSwap }

/// <summary>ExitForHelper: the host must quit right after InstallAsync so the detached helper can swap and relaunch it.</summary>
public sealed record InstallPlan(InstallKind Kind, bool ExitForHelper);

public static class InstallPlanner
{
    private static readonly Dictionary<ShellPlatform, InstallPlan> Plans = new()
    {
        [new(ShellOs.MacOs, ShellArch.Arm64)] = new(InstallKind.MacSwap, true),
        [new(ShellOs.MacOs, ShellArch.X64)] = new(InstallKind.MacSwap, true),
        [new(ShellOs.Windows, ShellArch.X64)] = new(InstallKind.WindowsSwap, true),
        [new(ShellOs.Linux, ShellArch.X64)] = new(InstallKind.LinuxAppImageReplace, true),
    };

    public static InstallPlan For(ShellPlatform platform) =>
        Plans.TryGetValue(platform, out var plan) ? plan : throw new NotSupportedException($"no install path for {platform.Os}/{platform.Arch}");
}

public static class AppImageInstaller
{
    public static void Replace(string stagedPath, string currentPath)
    {
        var temp = Path.Combine(Path.GetDirectoryName(currentPath)!, $".{Path.GetFileName(currentPath)}.update-{Environment.ProcessId}");
        try
        {
            File.Copy(stagedPath, temp, overwrite: true);
            if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(temp, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute | UnixFileMode.GroupRead | UnixFileMode.GroupExecute | UnixFileMode.OtherRead | UnixFileMode.OtherExecute);
            File.Move(temp, currentPath, overwrite: true);
        }
        finally
        {
            File.Delete(temp);
        }
    }
}

/// <summary>
/// Pure path rule: only per-user installs may self-update. The Electron version also checked realpath and
/// file ownership (uid); those host checks are not ported yet (see docs/planning avalonia-shell remaining work).
/// </summary>
public sealed record InstallLocation(ShellOs Os, string Executable, string Home, string? LocalAppData, string? AppImage)
{
    private const string Message = "This installation cannot be updated without administrator privileges. Reinstall CodeChroma in ~/Applications on macOS, as a user-local AppImage on Linux, or with the per-user Windows installer, then retry. Your settings and repositories will be preserved.";

    public static InstallLocation Current() => new(
        ShellPlatform.Current.Os, Environment.ProcessPath ?? "", Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        Environment.GetEnvironmentVariable("LOCALAPPDATA"), Environment.GetEnvironmentVariable("APPIMAGE"));

    public bool IsUserInstallation()
    {
        var (target, root) = Os switch
        {
            ShellOs.MacOs => (BundlePath(Executable), Home),
            ShellOs.Linux => (AppImage, Home),
            _ => (ParentDir(Executable), LocalAppData),
        };
        if (string.IsNullOrEmpty(target) || string.IsNullOrEmpty(root)) return false;
        var comparer = Os == ShellOs.Linux ? StringComparer.Ordinal : StringComparer.OrdinalIgnoreCase;
        var targetParts = Normalize(target);
        var rootParts = Normalize(root);
        if (targetParts.Length <= rootParts.Length || !targetParts.Take(rootParts.Length).SequenceEqual(rootParts, comparer)) return false;
        return Os != ShellOs.MacOs || targetParts.SequenceEqual(Normalize(Home + "/Applications/CodeChroma.app"), comparer);
    }

    public void AssertUserInstallation()
    {
        if (!IsUserInstallation()) throw new UnauthorizedAccessException(Message);
    }

    /// <summary>What an update replaces: the .app bundle (macOS), the AppImage file (Linux) or the app directory holding the exe (Windows).</summary>
    public string? TargetPath() => Os switch
    {
        ShellOs.MacOs => BundlePath(Executable),
        ShellOs.Linux => AppImage,
        _ => ParentDir(Executable) is { Length: > 0 } dir ? dir : null,
    };

    private static string? BundlePath(string executable)
    {
        var index = executable.Replace('\\', '/').IndexOf(".app/", StringComparison.Ordinal);
        return index < 0 ? null : executable.Replace('\\', '/')[..(index + 4)];
    }

    private static string ParentDir(string executable)
    {
        var path = executable.Replace('\\', '/');
        var slash = path.LastIndexOf('/');
        return slash <= 0 ? "" : path[..slash];
    }

    private static string[] Normalize(string path)
    {
        var parts = new List<string>();
        foreach (var segment in path.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (segment == ".") continue;
            if (segment == "..") { if (parts.Count > 0) parts.RemoveAt(parts.Count - 1); continue; }
            parts.Add(segment);
        }
        return [.. parts];
    }
}
