using System.Text;
using System.Text.RegularExpressions;

namespace CodeChroma.Core.Analyzers;

/// <summary>pathspec's "gitignore" (basic) pattern set: last matching pattern wins.</summary>
public sealed class GitIgnoreSpec
{
    private readonly List<(Regex Regex, bool Include)> _patterns = [];

    public GitIgnoreSpec(IEnumerable<string> lines)
    {
        foreach (var line in lines)
        {
            var (regex, include) = PatternToRegex(line);
            if (regex is not null && include is { } inc) _patterns.Add((new Regex(regex, RegexOptions.CultureInvariant), inc));
        }
    }

    public bool MatchFile(string file)
    {
        if (file.StartsWith('/')) file = file[1..];
        else if (file.StartsWith("./", StringComparison.Ordinal)) file = file[2..];
        var result = false;
        foreach (var (regex, include) in _patterns)
            if (regex.IsMatch(file)) result = include;
        return result;
    }

    private static (string? Regex, bool? Include) PatternToRegex(string pattern)
    {
        var text = pattern.EndsWith("\\ ", StringComparison.Ordinal) ? pattern : Syntax.PyStrip(pattern);
        if (text.Length == 0 || text.StartsWith('#')) return (null, null);
        bool include;
        if (text.StartsWith('!')) { include = false; text = text[1..]; }
        else include = true;

        var segs = text.Split('/').ToList();
        var isDir = segs[^1].Length == 0;
        if (text == "/") isDir = false;

        if (segs[0].Length == 0) segs.RemoveAt(0);
        else if (segs.Count == 1 || (segs.Count == 2 && segs[1].Length == 0))
        {
            if (segs[0] != "**") segs.Insert(0, "**");
        }
        if (segs.Count == 0) throw new FormatException($"Invalid git pattern: {pattern}");
        if (segs[^1].Length == 0) segs[^1] = "**";
        for (var i = segs.Count - 1; i > 0; i--)
            if (segs[i - 1] == "**" && segs[i] == "**") segs.RemoveAt(i);

        if (segs.Count == 1 && segs[0] == "**") return (isDir ? "/" : ".", include);
        if (segs.Count == 2 && segs[0] == "**" && segs[1] == "*") return (".", include);
        if (segs.Count == 3 && segs[0] == "**" && segs[1] == "*" && segs[2] == "**") return ("/", include);

        var sb = new StringBuilder();
        var needSlash = false;
        var end = segs.Count - 1;
        for (var i = 0; i < segs.Count; i++)
        {
            var seg = segs[i];
            if (seg == "**")
            {
                if (i == 0) sb.Append("^(?:.+/)?");
                else if (i < end) { sb.Append("(?:/.+)?"); needSlash = true; }
                else sb.Append('/');
            }
            else
            {
                if (i == 0) sb.Append('^');
                if (needSlash) sb.Append('/');
                sb.Append(seg == "*" ? "[^/]+" : TranslateSegmentGlob(seg));
                if (i == end) sb.Append(seg == "*" ? "/?$" : "(?:/|$)");
                needSlash = true;
            }
        }
        return (sb.ToString(), include);
    }

    private static string TranslateSegmentGlob(string pattern)
    {
        var escape = false;
        var regex = new StringBuilder();
        int i = 0, end = pattern.Length;
        while (i < end)
        {
            var ch = pattern[i++];
            if (escape) { escape = false; regex.Append(Regex.Escape(ch.ToString())); }
            else if (ch == '\\') escape = true;
            else if (ch == '*') regex.Append("[^/]*");
            else if (ch == '?') regex.Append("[^/]");
            else if (ch == '[')
            {
                var j = i;
                if (j < end && (pattern[j] == '!' || pattern[j] == '^')) j++;
                if (j < end && pattern[j] == ']') j++;
                while (j < end && pattern[j] != ']') j++;
                if (j < end)
                {
                    j++;
                    var expr = "[";
                    if (pattern[i] == '!' || pattern[i] == '^') { expr += "^"; i++; }
                    expr += pattern[i..j].Replace("\\", "\\\\");
                    regex.Append(expr);
                    i = j;
                }
                else regex.Append("\\[");
            }
            else regex.Append(Regex.Escape(ch.ToString()));
        }
        if (escape) throw new FormatException($"Escape character found with no next character to escape: {pattern}");
        return regex.ToString();
    }
}

/// <summary>Lists a repo's analyzable files exactly as GraphEngine's _iter_repo_files does.</summary>
public static class RepoScanner
{
    public static readonly IReadOnlySet<string> IgnoredDirs = new HashSet<string>(StringComparer.Ordinal)
    {
        ".git", "__pycache__", ".venv", "venv", "node_modules", ".codechroma", "dist", "build",
        ".mypy_cache", ".pytest_cache", ".ruff_cache", ".idea", ".vscode", ".DS_Store", ".editorconfig",
    };

    private static readonly string[] BuiltinNoisePatterns = ["vendor/", "worktrees/"];

    /// <summary>One .gitignore line re-anchored under <paramref name="prefix"/> so it matches only within that subtree.</summary>
    public static string? RewriteGitignoreLine(string line, string prefix)
    {
        var stripped = Syntax.PyStrip(line);
        if (stripped.Length == 0 || stripped.StartsWith('#')) return null;
        var negate = stripped.StartsWith('!');
        var body = negate ? stripped[1..] : stripped;
        string pattern;
        if (body.StartsWith('/')) pattern = prefix + body[1..];
        else if (body.TrimEnd('/').Contains('/')) pattern = prefix + body;
        else pattern = prefix.Length > 0 ? $"{prefix}**/{body}" : $"**/{body}";
        return negate ? "!" + pattern : pattern;
    }

    /// <summary>True for anything inside a .claude/skills/codechroma-* copy the bridge installs itself.</summary>
    public static bool IsSyncedSkillPath(string relativePosix)
    {
        var parts = relativePosix.Split('/');
        return parts.Length > 2 && parts[0] == ".claude" && parts[1] == "skills" && parts[2].StartsWith("codechroma-", StringComparison.Ordinal);
    }

    public static List<string> ListFiles(string repoRoot)
    {
        var lines = new List<string>(BuiltinNoisePatterns);
        var spec = new GitIgnoreSpec(lines);
        var result = new List<string>();
        Walk(repoRoot, "", lines, ref spec, result);
        return result;
    }

    private static void Walk(string absDir, string relDir, List<string> lines, ref GitIgnoreSpec spec, List<string> result)
    {
        List<string> dirnames = [], filenames = [];
        try
        {
            foreach (var entry in new DirectoryInfo(absDir).EnumerateFileSystemInfos())
            {
                var isDir = entry is DirectoryInfo;
                if (isDir) dirnames.Add(entry.Name);
                else filenames.Add(entry.Name);
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return; }

        if (filenames.Contains(".gitignore"))
        {
            var prefix = relDir.Length == 0 ? "" : relDir + "/";
            try
            {
                var raw = File.ReadAllText(Path.Combine(absDir, ".gitignore"));
                foreach (var rawLine in Syntax.SplitLines(raw))
                    if (RewriteGitignoreLine(rawLine, prefix) is { } rewritten) lines.Add(rewritten);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
            spec = new GitIgnoreSpec(lines);
        }

        dirnames.Sort(StringComparer.Ordinal);
        filenames.Sort(StringComparer.Ordinal);
        var kept = new List<string>();
        foreach (var d in dirnames)
        {
            if (IgnoredDirs.Contains(d)) continue;
            var relDirPath = relDir.Length == 0 ? d : $"{relDir}/{d}";
            if (spec.MatchFile(relDirPath + "/")) continue;
            kept.Add(d);
        }
        foreach (var filename in filenames)
        {
            var relative = relDir.Length == 0 ? filename : $"{relDir}/{filename}";
            if (IsSyncedSkillPath(relative)) continue;
            if (spec.MatchFile(relative)) continue;
            result.Add(relative);
        }
        foreach (var d in kept)
        {
            var abs = Path.Combine(absDir, d);
            if (new DirectoryInfo(abs).LinkTarget is not null) continue;
            Walk(abs, relDir.Length == 0 ? d : $"{relDir}/{d}", lines, ref spec, result);
        }
    }
}
