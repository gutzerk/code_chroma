namespace CodeChroma.Bridge.Workspaces;

/// <summary>Symlink-resolved paths, so `/tmp` vs `/private/tmp` (or a linked home) compare equal to what git and getcwd report.</summary>
public static class RealPaths
{
    private const int MaxLinkHops = 40;

    /// <summary>The canonical absolute path like realpath(3): links and junctions followed, `..` applied after them, a missing tail kept as-is.</summary>
    public static string Resolve(string path)
    {
        var absolute = Path.Combine(Environment.CurrentDirectory, path);
        var current = RootOf(absolute, Environment.CurrentDirectory);
        var pending = new Stack<string>();
        Push(pending, absolute[(Path.GetPathRoot(absolute) ?? "").Length..]);
        var hops = 0;
        while (pending.TryPop(out var part))
        {
            if (part is "" or ".") continue;
            if (part == "..") { current = Path.GetDirectoryName(current) ?? current; continue; }
            var next = Path.Combine(current, part);
            var target = hops < MaxLinkHops ? LinkTarget(next) : null;
            if (target is null) { current = next; continue; }
            hops++;
            if (Path.IsPathRooted(target)) current = RootOf(target, current);
            Push(pending, target[(Path.GetPathRoot(target) ?? "").Length..]);
        }
        return current;
    }

    private static string RootOf(string path, string relativeTo) => Path.GetPathRoot(Path.GetFullPath(Path.GetPathRoot(path) ?? "", relativeTo)) ?? "";

    private static void Push(Stack<string> pending, string relative)
    {
        var parts = relative.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        for (var i = parts.Length - 1; i >= 0; i--) pending.Push(parts[i]);
    }

    private static string? LinkTarget(string path)
    {
        try
        {
            FileSystemInfo info = Directory.Exists(path) ? new DirectoryInfo(path) : new FileInfo(path);
            return info.LinkTarget;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return null; }
    }
}
