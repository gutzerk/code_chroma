using System.Text;

namespace CodeChroma.Core.Wiki;

/// <summary>One undocumented module/class/method/function, for a later AI pass to target.</summary>
public sealed record GapEntry(string Path, string QualifiedName, string Kind, string Reason = "no docstring");

/// <summary>What one wiki generation wrote and how much of the repo is documented.</summary>
public sealed record WikiResult(string OutputDir, IReadOnlyList<string> Pages, string GapReportPath, string GapJsonPath, int UndocumentedCount);

/// <summary>What one wiki sync found stale and wrote.</summary>
public sealed record WikiSyncResult(IReadOnlyList<string> ChangedPaths, IReadOnlyList<string> RegeneratedPages, bool FullRegeneration);

/// <summary>Pure markdown-string builders for the wiki's pages; no I/O, no graph traversal (wiki/writer.py).</summary>
public static class WikiWriter
{
    public const string NoDocstring = "*no docstring*";
    public const string NoBreakdown = "*no class/function breakdown for this language*";

    private static string Join(IEnumerable<string> lines) => string.Join('\n', lines) + "\n";

    public static string RenderRootPage(string repoName, IEnumerable<(string Name, string Link)> folders)
    {
        var lines = new List<string> { $"# {repoName}", "", "## Folders", "" };
        lines.AddRange(folders.Select(f => $"- [{f.Name}]({f.Link})"));
        return Join(lines);
    }

    private static string Hint(string? hint) => string.IsNullOrEmpty(hint) ? NoDocstring : hint;

    public static string RenderFolderPage(string folderPath, IReadOnlyList<(string Name, string Link)> subfolders, IReadOnlyList<(string Name, string Link, string? Hint)> files)
    {
        var lines = new List<string> { $"# {folderPath}/", "" };
        if (subfolders.Count > 0)
        {
            lines.AddRange(["## Subfolders", ""]);
            lines.AddRange(subfolders.Select(s => $"- [{s.Name}]({s.Link})"));
            lines.Add("");
        }
        lines.AddRange(["## Files", ""]);
        lines.AddRange(files.Select(f => $"- [{f.Name}]({f.Link}) — {Hint(f.Hint)}"));
        return Join(lines);
    }

    public static string RenderFolderSubindex(string folderPath, int part, int totalParts, IEnumerable<(string Name, string Link, string? Hint)> entries)
    {
        var lines = new List<string> { $"# {folderPath}/ (part {part} of {totalParts})", "" };
        lines.AddRange(entries.Select(e => $"- [{e.Name}]({e.Link}) — {Hint(e.Hint)}"));
        return Join(lines);
    }

    private static IEnumerable<string> RenderMethods(IReadOnlyList<(string Name, string? Docstring)> methods)
    {
        if (methods.Count == 0) yield break;
        yield return "";
        yield return "#### Methods";
        yield return "";
        foreach (var (name, docstring) in methods) yield return $"- `{name}` — {Hint(docstring)}";
    }

    public static string RenderFilePage(
        string filePath,
        string? moduleDocstring,
        IReadOnlyList<(string Name, int Line)> variables,
        IReadOnlyList<(string Name, string? Docstring, IReadOnlyList<(string Name, string? Docstring)> Methods)> classes,
        IReadOnlyList<(string Name, string? Docstring)> functions,
        bool hasBreakdown)
    {
        var lines = new List<string> { $"# {filePath}", "", Hint(moduleDocstring) };
        if (!hasBreakdown)
        {
            lines.AddRange(["", NoBreakdown]);
            return Join(lines);
        }
        if (variables.Count > 0)
        {
            lines.AddRange(["", "## Module Parameters", ""]);
            lines.AddRange(variables.Select(v => $"- `{v.Name}` (line {v.Line})"));
        }
        if (classes.Count > 0)
        {
            lines.AddRange(["", "## Classes"]);
            foreach (var (name, docstring, methods) in classes)
            {
                lines.AddRange(["", $"### {name}", "", Hint(docstring)]);
                lines.AddRange(RenderMethods(methods));
            }
        }
        if (functions.Count > 0)
        {
            lines.AddRange(["", "## Functions", ""]);
            lines.AddRange(functions.Select(f => $"- `{f.Name}` — {Hint(f.Docstring)}"));
        }
        return Join(lines);
    }

    public static string RenderGapReport(IReadOnlyList<GapEntry> gaps)
    {
        if (gaps.Count == 0) return "# Documentation Gaps\n\nNone -- everything has a docstring.\n";
        var lines = new List<string> { "# Documentation Gaps", "" };
        foreach (var group in gaps.GroupBy(g => g.Path).OrderBy(g => g.Key, StringComparer.Ordinal))
        {
            lines.Add($"## {group.Key}");
            lines.Add("");
            foreach (var gap in group.OrderBy(g => g.Kind, StringComparer.Ordinal).ThenBy(g => g.QualifiedName, StringComparer.Ordinal))
                lines.Add($"- {gap.Kind} `{gap.QualifiedName}` — {gap.Reason}");
            lines.Add("");
        }
        return new StringBuilder(string.Join('\n', lines).TrimEnd()).Append('\n').ToString();
    }
}
