using System.Text;

namespace CodeChroma.Bridge.Routes;

/// <summary>File reading helpers matching codechroma/io.py: strict UTF-8, universal newlines, 1-based line slices.</summary>
public static class SourceText
{
    private static readonly UTF8Encoding Strict = new(false, true);

    private static readonly Dictionary<string, string> LanguageBySuffix = new(StringComparer.Ordinal)
    {
        [".c"] = "c", [".cc"] = "cpp", [".cpp"] = "cpp", [".cs"] = "csharp", [".cxx"] = "cpp", [".go"] = "go",
        [".h"] = "cpp", [".hpp"] = "cpp", [".hxx"] = "cpp", [".java"] = "java", [".js"] = "typescript",
        [".jsx"] = "typescript", [".php"] = "php", [".py"] = "python", [".rb"] = "ruby", [".rs"] = "rust",
        [".ts"] = "typescript", [".tsx"] = "typescript", [".yaml"] = "yaml", [".yml"] = "yaml",
    };

    public static string? LanguageFor(string filePath)
    {
        var suffix = Path.GetExtension(filePath);
        if (suffix is ".md" or ".markdown") return "markdown";
        return LanguageBySuffix.GetValueOrDefault(suffix);
    }

    /// <summary>File contents, or null when unreadable or not valid UTF-8 text.</summary>
    public static string? Read(string path)
    {
        try
        {
            return Strict.GetString(File.ReadAllBytes(path)).Replace("\r\n", "\n").Replace('\r', '\n');
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or DecoderFallbackException)
        {
            return null;
        }
    }

    public static bool IsWithin(string baseDir, string path)
    {
        var root = Path.GetFullPath(baseDir).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var full = Path.GetFullPath(path);
        return full.StartsWith(root, StringComparison.OrdinalIgnoreCase);
    }

    public static string? ReadWithin(string baseDir, string path) => IsWithin(baseDir, path) ? Read(path) : null;

    /// <summary>The inclusive 1-based [start, end] span of lines; end null runs to the last line.</summary>
    public static string SliceLines(string text, int start, int? end)
    {
        var lines = text.Split('\n').ToList();
        if (lines.Count > 0 && lines[^1].Length == 0) lines.RemoveAt(lines.Count - 1);
        var from = Math.Max(start - 1, 0);
        var to = end is null ? lines.Count : Math.Min(Math.Max(end.Value, 0), lines.Count);
        return from >= to ? "" : string.Join("\n", lines.Skip(from).Take(to - from));
    }
}
