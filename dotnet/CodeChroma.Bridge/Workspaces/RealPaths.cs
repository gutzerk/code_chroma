namespace CodeChroma.Bridge.Workspaces;

/// <summary>Symlink-resolved paths, so `/tmp` vs `/private/tmp` (or a linked home) compare equal to what git and getcwd report.</summary>
public static class RealPaths
{
    /// <summary>The absolute path with every symlink or junction component replaced by its final target.</summary>
    public static string Resolve(string path)
    {
        var full = Path.GetFullPath(path);
        var current = Path.GetPathRoot(full) ?? "";
        foreach (var part in full[current.Length..].Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
        {
            if (part.Length == 0) continue;
            current = Path.Combine(current, part);
            try
            {
                FileSystemInfo info = Directory.Exists(current) ? new DirectoryInfo(current) : new FileInfo(current);
                if (info.LinkTarget is not null && info.ResolveLinkTarget(returnFinalTarget: true) is { } target) current = target.FullName;
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
        }
        return current;
    }
}
