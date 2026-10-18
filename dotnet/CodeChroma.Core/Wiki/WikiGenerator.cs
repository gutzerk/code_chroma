using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using FileGroup = CodeChroma.Core.DependencyDigest.FileSymbolsView;

namespace CodeChroma.Core.Wiki;

/// <summary>Walks an already-parsed Graph and writes the markdown wiki tree to disk (wiki/generator.py).</summary>
public static class WikiGenerator
{
    public const int DefaultFolderEntryCap = 100;

    public static void WriteTextFile(string path, string text)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, text, new UTF8Encoding(false));
    }

    public static Dictionary<string, List<HierarchyNode>> ChildrenByParent(Graph graph)
    {
        var children = new Dictionary<string, List<HierarchyNode>>();
        foreach (var node in graph.NodeList)
            foreach (var parentId in node.ParentIds)
            {
                if (!children.TryGetValue(parentId, out var list)) children[parentId] = list = [];
                list.Add(node);
            }
        return children;
    }

    private static readonly char[] LineBreaks = [(char)0x0a, (char)0x0d, (char)0x0b, (char)0x0c, (char)0x1c, (char)0x1d, (char)0x1e, (char)0x85, (char)0x2028, (char)0x2029];

    /// <summary>The first line of a docstring, splitting on every boundary Python's str.splitlines() does.</summary>
    private static string? FirstLine(string? text)
    {
        if (string.IsNullOrEmpty(text)) return null;
        var end = text.IndexOfAny(LineBreaks);
        return end < 0 ? text : text[..end];
    }

    private static string FolderLinkPath(string folderPath) => $"files/{folderPath}/index.md";

    /// <summary>`src/config.py` becomes `src/config.md`, the page's path under `files/`.</summary>
    public static string FilePageRelativePath(string filePath)
    {
        var slash = filePath.LastIndexOf('/');
        var dot = filePath.LastIndexOf('.');
        // A leading dot (".gitignore") is a name, not a suffix.
        return dot > slash + 1 ? filePath[..dot] + ".md" : filePath + ".md";
    }

    private static string FileName(string path) => path[(path.LastIndexOf('/') + 1)..];

    private static bool IsFolder(HierarchyNode node) => node.Level is HierarchyLevel.System or HierarchyLevel.Pillar;

    private static (List<(string Name, string Link)> Subfolders, List<(string Name, string Link, string? Hint)> Files) FolderEntries(
        HierarchyNode folder, Dictionary<string, List<HierarchyNode>> childrenMap, Dictionary<string, FileGroup> filesByPath)
    {
        var subfolders = new List<(string, string)>();
        var files = new List<(string, string, string?)>();
        var children = childrenMap.GetValueOrDefault(folder.Id) ?? [];
        foreach (var child in children.OrderBy(n => n.Name, StringComparer.Ordinal))
        {
            if (child.Level == HierarchyLevel.Component)
            {
                var filePath = child.SourcePath ?? "";
                if (!filesByPath.TryGetValue(filePath, out var group)) continue;
                files.Add((FileName(filePath), FileName(FilePageRelativePath(filePath)), group.Module is null ? null : FirstLine(group.Module.Docstring)));
            }
            else
            {
                subfolders.Add((child.Name, $"{child.Name}/index.md"));
            }
        }
        return (subfolders, files);
    }

    public static List<string> WriteFolderPage(
        HierarchyNode folder, Dictionary<string, List<HierarchyNode>> childrenMap, Dictionary<string, FileGroup> filesByPath, string outputDir, int cap = DefaultFolderEntryCap)
    {
        var folderPath = folder.SourcePath ?? folder.Name;
        var (subfolders, files) = FolderEntries(folder, childrenMap, filesByPath);
        var folderDir = Path.Combine(outputDir, "files", folderPath);
        if (subfolders.Count + files.Count <= cap)
        {
            var only = Path.Combine(folderDir, "index.md");
            WriteTextFile(only, WikiWriter.RenderFolderPage(folderPath, subfolders, files));
            return [only];
        }

        var combined = subfolders.Select(s => (s.Name, s.Link, (string?)null)).Concat(files).ToList();
        var chunks = combined.Chunk(cap).ToList();
        var pages = new List<string>();
        var subLinks = new List<(string, string)>();
        for (var part = 1; part <= chunks.Count; part++)
        {
            var name = $"sub_index_{part}.md";
            var subPath = Path.Combine(folderDir, name);
            WriteTextFile(subPath, WikiWriter.RenderFolderSubindex(folderPath, part, chunks.Count, chunks[part - 1]));
            pages.Add(subPath);
            subLinks.Add(($"part {part}", name));
        }
        var index = Path.Combine(folderDir, "index.md");
        WriteTextFile(index, WikiWriter.RenderFolderPage(folderPath, subLinks, []));
        pages.Insert(0, index);
        return pages;
    }

    private static bool HasModuleVariables(FileGroup group) => group.Module is { Language: "python" or "go" };

    private static bool ShouldFlagGap(Symbol symbol, string language, bool tsGapEligible)
    {
        if (symbol.Docstring is not null) return false;
        return language switch
        {
            "python" => true,
            // A package isn't capitalization-gated like a Go identifier, so it is always flagged undocumented.
            "go" => symbol.Kind == SymbolKind.Module || symbol.IsExported,
            "typescript" => tsGapEligible && symbol.IsExported,
            _ => false,
        };
    }

    private static List<GapEntry> GapsForFile(FileGroup group)
    {
        var gaps = new List<GapEntry>();
        if (group.Module is not { } module) return gaps;
        var language = module.Language;
        var tsEligible = group.Path.EndsWith(".ts", StringComparison.Ordinal) || group.Path.EndsWith(".tsx", StringComparison.Ordinal);
        if (ShouldFlagGap(module, language, tsEligible)) gaps.Add(new GapEntry(group.Path, module.QualifiedName, "module"));
        foreach (var cls in group.Classes)
        {
            if (ShouldFlagGap(cls, language, tsEligible)) gaps.Add(new GapEntry(group.Path, cls.QualifiedName, "class"));
            foreach (var method in group.MethodsByClassId.GetValueOrDefault(cls.Id) ?? [])
                if (ShouldFlagGap(method, language, tsEligible)) gaps.Add(new GapEntry(group.Path, method.QualifiedName, "method"));
        }
        foreach (var function in group.Functions)
            if (ShouldFlagGap(function, language, tsEligible)) gaps.Add(new GapEntry(group.Path, function.QualifiedName, "function"));
        return gaps;
    }

    private static int CompareDoc(string? a, string? b) => string.CompareOrdinal(a, b);

    public static string WriteFilePage(FileGroup group, string outputDir)
    {
        var hasBreakdown = group.Module is not null;
        var variables = HasModuleVariables(group)
            ? group.Variables.OrderBy(v => v.Name, StringComparer.Ordinal).ThenBy(v => v.StartLine).Select(v => (v.Name, v.StartLine)).ToList()
            : [];
        var classes = hasBreakdown
            ? group.Classes.OrderBy(c => c.Name, StringComparer.Ordinal).Select(c => (
                c.Name, c.Docstring,
                (IReadOnlyList<(string, string?)>)(group.MethodsByClassId.GetValueOrDefault(c.Id) ?? [])
                    .OrderBy(m => m.Name, StringComparer.Ordinal).ThenBy(m => m.Docstring, Comparer<string?>.Create(CompareDoc))
                    .Select(m => (m.Name, m.Docstring)).ToList())).ToList()
            : [];
        var functions = hasBreakdown
            ? group.Functions.OrderBy(f => f.Name, StringComparer.Ordinal).ThenBy(f => f.Docstring, Comparer<string?>.Create(CompareDoc)).Select(f => (f.Name, f.Docstring)).ToList()
            : [];
        var text = WikiWriter.RenderFilePage(group.Path, group.Module?.Docstring, variables, classes, functions, hasBreakdown);
        var page = Path.Combine(outputDir, "files", FilePageRelativePath(group.Path));
        WriteTextFile(page, text);
        return page;
    }

    public static List<GapEntry> ComputeGaps(Dictionary<string, FileGroup> filesByPath) =>
        filesByPath.Keys.Order(StringComparer.Ordinal).SelectMany(path => GapsForFile(filesByPath[path])).ToList();

    public static (string Report, string Json) WriteGapReports(IReadOnlyList<GapEntry> gaps, string outputDir)
    {
        var reportPath = Path.Combine(outputDir, "gaps.md");
        var jsonPath = Path.Combine(outputDir, "gaps.json");
        WriteTextFile(reportPath, WikiWriter.RenderGapReport(gaps));
        var array = new JsonArray(gaps.Select(g => (JsonNode?)new JsonObject
        {
            ["path"] = g.Path, ["qualified_name"] = g.QualifiedName, ["kind"] = g.Kind, ["reason"] = g.Reason,
        }).ToArray());
        WriteTextFile(jsonPath, array.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        return (reportPath, jsonPath);
    }

    public static string WriteRootPage(Graph graph, string repoRoot, string outputDir)
    {
        var topLevel = graph.NodeList.Where(n => n.Level == HierarchyLevel.System).OrderBy(n => n.Name, StringComparer.Ordinal);
        var folders = topLevel.Select(f => (f.Name, FolderLinkPath(f.SourcePath ?? f.Name)));
        var rootPath = Path.Combine(outputDir, "index.md");
        var repoName = new DirectoryInfo(Path.GetFullPath(repoRoot)).Name;
        WriteTextFile(rootPath, WikiWriter.RenderRootPage(repoName, folders));
        return rootPath;
    }

    /// <summary>Reads an in-memory Graph and writes markdown pages plus the gap report.</summary>
    public static WikiResult Generate(
        Graph graph, string repoRoot, string outputDir,
        Dictionary<string, List<HierarchyNode>>? childrenMap = null, Dictionary<string, FileGroup>? filesByPath = null, int cap = DefaultFolderEntryCap)
    {
        try { if (Directory.Exists(outputDir)) Directory.Delete(outputDir, true); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        filesByPath ??= DependencyDigest.GroupByFile(graph);
        childrenMap ??= ChildrenByParent(graph);
        var folders = graph.NodeList.Where(IsFolder).OrderBy(n => n.SourcePath ?? n.Name, StringComparer.Ordinal).ToList();

        var pages = new List<string> { WriteRootPage(graph, repoRoot, outputDir) };
        foreach (var folder in folders) pages.AddRange(WriteFolderPage(folder, childrenMap, filesByPath, outputDir, cap));
        foreach (var path in filesByPath.Keys.Order(StringComparer.Ordinal)) pages.Add(WriteFilePage(filesByPath[path], outputDir));

        var gaps = ComputeGaps(filesByPath);
        var (report, json) = WriteGapReports(gaps, outputDir);
        return new WikiResult(outputDir, pages, report, json, gaps.Count);
    }
}
