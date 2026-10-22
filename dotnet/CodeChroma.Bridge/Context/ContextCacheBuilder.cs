using System.Text.RegularExpressions;
using CodeChroma.Core;
using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Context;

/// <summary>Reads wiki-general (manifest, c2/c3 pages) plus the graph's symbols into the compact <see cref="ContextData"/>.</summary>
public static partial class ContextCacheBuilder
{
    /// <summary>Bumped whenever the built data changes shape, so existing caches rebuild.</summary>
    internal const int Version = 3;

    public static ContextData Build(string wikiDir, Graph graph, string fingerprint)
    {
        var manifest = JsonNode.Parse(File.ReadAllText(Path.Combine(wikiDir, "manifest.json")))!.AsObject();
        var containers = (manifest["containers"]?.AsArray() ?? []).OfType<JsonObject>().Select(c => ReadContainer(wikiDir, c)).ToList();
        var symbols = new SymbolIndex(graph);
        var pages = (manifest["components"]?.AsArray() ?? []).OfType<JsonObject>().Select(c => ReadPage(wikiDir, c, symbols)).ToList();
        var edges = (manifest["edges"]?.AsArray() ?? []).OfType<JsonObject>()
            .Select(e => new EdgeInfo((string)e["from"]!, (string)e["to"]!, e["count"]?.GetValue<int>() ?? 1)).ToList();
        // wiki-general clusters code only, so CI workflows and scripts get their own pages (repo root = two levels above wiki-general).
        var repoRoot = Path.GetFullPath(Path.Combine(wikiDir, "..", ".."));
        var automation = AutomationPages.Pages(repoRoot);
        if (automation.Count > 0)
        {
            containers.Add(AutomationPages.Container());
            pages.AddRange(automation);
        }
        return new ContextData(fingerprint, containers, pages, edges);
    }

    internal static bool IsTestFile(string path)
    {
        var name = Path.GetFileName(path);
        return name.EndsWith("_test.go") || name.Contains(".test.") || name.Contains(".spec.") || name.StartsWith("test_") || name.EndsWith("Tests.cs") || name.EndsWith("_test.py");
    }

    private static ContainerInfo ReadContainer(string wikiDir, JsonObject entry)
    {
        var (title, description) = ReadPageText(wikiDir, (string?)entry["path"]);
        return new ContainerInfo((string)entry["id"]!, (string?)entry["name"] ?? (string)entry["id"]!, title, description);
    }

    private static PageInfo ReadPage(string wikiDir, JsonObject entry, SymbolIndex symbols)
    {
        var (title, description) = ReadPageText(wikiDir, (string?)entry["path"]);
        var withSymbols = new List<FileEntry>();
        var others = new List<string>();
        foreach (var file in (entry["files"]?.AsArray() ?? []).Select(f => (string)f!).Where(f => !IsTestFile(f)))
        {
            var lines = symbols.ForFile(file);
            if (lines.Count > 0) withSymbols.Add(new FileEntry(file, lines));
            else others.Add(file);
        }
        var files = withSymbols.OrderByDescending(f => f.Symbols.Count(s => s.Calls.Count > 0)).ThenBy(f => f.Path, StringComparer.Ordinal).ToList();
        var id = (string)entry["id"]!;
        return new PageInfo(id, (string?)entry["name"] ?? id, (string?)entry["container"] ?? "", title, description, files, others);
    }

    /// <summary>The page's heading line and first paragraph.</summary>
    private static (string Title, string Description) ReadPageText(string wikiDir, string? relative)
    {
        var path = relative is null ? null : Path.Combine(wikiDir, relative);
        if (path is null || !File.Exists(path)) return ("", "");
        var lines = File.ReadAllLines(path);
        var title = lines.FirstOrDefault(l => l.StartsWith("# "))?[2..].Trim() ?? "";
        var description = lines.Skip(1).FirstOrDefault(l => l.Trim().Length > 0 && !l.StartsWith('#') && !l.StartsWith('-'))?.Trim() ?? "";
        return (title, description);
    }

    [GeneratedRegex(@"^Error\d{3}$")]
    private static partial Regex ErrorCode();

    /// <summary>Graph symbols by file, with the repo-function filter that turns raw references into the calls worth showing.</summary>
    private sealed class SymbolIndex
    {
        private readonly Dictionary<string, List<Symbol>> _byFile;
        private readonly HashSet<string> _repoFunctions;

        public SymbolIndex(Graph graph)
        {
            _byFile = graph.SymbolList.GroupBy(s => s.FilePath).ToDictionary(g => g.Key, g => g.ToList());
            _repoFunctions = graph.SymbolList.Where(s => s.Kind == SymbolKind.Function).Select(s => s.Name).ToHashSet();
        }

        /// <summary>The file's functions and classes in source order, each with its filtered calls.</summary>
        public List<SymbolLine> ForFile(string file)
        {
            if (!_byFile.TryGetValue(file, out var inFile)) return [];
            return inFile.Where(s => s.Kind is SymbolKind.Function or SymbolKind.Class).OrderBy(s => s.StartLine).Select(Line).DistinctBy(l => l.NodeId).ToList();
        }

        private SymbolLine Line(Symbol symbol)
        {
            var isClass = symbol.Kind == SymbolKind.Class;
            var calls = isClass ? [] : symbol.References.Where(r => r != symbol.Name && (_repoFunctions.Contains(r) || ErrorCode().IsMatch(r))).Distinct().Take(ContextLimits.MaxCalls).ToList();
            return new SymbolLine(symbol.Id, symbol.Name, isClass, symbol.StartLine, symbol.EndLine, calls);
        }
    }
}
