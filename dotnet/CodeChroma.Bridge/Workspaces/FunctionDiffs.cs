using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Engine;
using CodeChroma.Bridge.Routes;
using CodeChroma.Core;
using HierarchyLevel = CodeChroma.Bridge.Engine.HierarchyLevel;

namespace CodeChroma.Bridge.Workspaces;

/// <summary>Parses a file's text as it was at the diff base; the analyzers stay behind this seam.</summary>
public interface IOldSymbolParser
{
    /// <summary>Symbols per repo path; a path maps to null when no analyzer could parse it.</summary>
    IReadOnlyDictionary<string, IReadOnlyList<Symbol>?> Parse(IReadOnlyDictionary<string, byte[]> filesByPath);
}

/// <summary>Writes the old bytes into a scratch root and lets the exporter's analyzers parse them in place.</summary>
public sealed class ExporterSymbolParser(IAnalysisExporter exporter) : IOldSymbolParser
{
    public IReadOnlyDictionary<string, IReadOnlyList<Symbol>?> Parse(IReadOnlyDictionary<string, byte[]> filesByPath)
    {
        var result = new Dictionary<string, IReadOnlyList<Symbol>?>();
        if (filesByPath.Count == 0) return result;
        var scratch = Path.Combine(Path.GetTempPath(), "cc-old-" + Guid.NewGuid().ToString("N")[..10]);
        try
        {
            foreach (var (path, bytes) in filesByPath)
            {
                var target = Path.Combine(scratch, path);
                Directory.CreateDirectory(Path.GetDirectoryName(target)!);
                File.WriteAllBytes(target, bytes);
            }
            var delta = exporter.Delta(scratch, [.. filesByPath.Keys]);
            foreach (var file in delta.Changed) result[file.Path] = file.Symbols;
        }
        finally
        {
            try { Directory.Delete(scratch, recursive: true); } catch (IOException) { }
        }
        return result;
    }
}

/// <summary>Finds FUNCTION source that differs from the diff base, plus newly-added file/class container nodes.</summary>
public static class FunctionDiffs
{
    /// <summary>The suffixes the language analyzers register; a file with another suffix is never parsed.</summary>
    private static readonly HashSet<string> AnalyzedSuffixes =
    [
        ".c", ".cpp", ".cc", ".cxx", ".hpp", ".hxx", ".h", ".cs", ".go", ".java", ".php", ".py", ".rb", ".rs",
        ".ts", ".tsx", ".js", ".jsx", ".yml", ".yaml",
    ];

    public static bool HasAnalyzer(string filePath) => AnalyzedSuffixes.Contains(Path.GetExtension(filePath));

    /// <summary>One file's text and symbols at the base commit.</summary>
    internal sealed record OldFile(Dictionary<string, Symbol> Functions, Dictionary<string, Symbol> Containers, string Text, string SliceText, bool Existed);

    /// <summary>Loads the base-side view of every analyzable path with one parser call.</summary>
    internal static Dictionary<string, OldFile> LoadOld(GitTree tree, IOldSymbolParser parser, IEnumerable<string> paths, string baseRef)
    {
        var bytes = new Dictionary<string, byte[]>();
        var all = new Dictionary<string, byte[]>();
        foreach (var path in paths.Where(HasAnalyzer).Distinct())
        {
            var content = tree.HeadContent(path, baseRef);
            all[path] = content;
            if (content.Length > 0) bytes[path] = content;
        }
        var parsed = parser.Parse(bytes);
        var result = new Dictionary<string, OldFile>();
        foreach (var (path, content) in all)
        {
            var symbols = parsed.GetValueOrDefault(path) ?? [];
            var text = Encoding.UTF8.GetString(content);
            result[path] = new OldFile(
                symbols.Where(s => s.Kind == SymbolKind.Function).GroupBy(s => s.Id).ToDictionary(g => g.Key, g => g.Last()),
                symbols.Where(s => s.Kind is SymbolKind.Class or SymbolKind.Module).GroupBy(s => s.Id).ToDictionary(g => g.Key, g => g.Last()),
                text, text.Replace("\r\n", "\n").Replace('\r', '\n'), content.Length > 0);
        }
        return result;
    }

    /// <summary>Every FUNCTION added/modified/deleted vs the base, as {node_id, name, status, ...source} objects.</summary>
    public static List<JsonObject> Compute(IGraphEngine engine, string repoRoot, IOldSymbolParser parser, string baseRef = "HEAD")
    {
        var tree = GitTree.Detect(repoRoot);
        if (tree is null) return [];
        var status = tree.Status(baseRef);
        if (status.Changed.Count == 0 && status.Deleted.Count == 0) return [];

        var (functionsByFile, containersByFile) = FunctionsAndContainersBySourcePath(engine);
        var old = LoadOld(tree, parser, status.Changed.Concat(status.Deleted), baseRef);
        var results = new List<JsonObject>();
        foreach (var filePath in status.Changed)
            results.AddRange(ForPresentFile(engine, repoRoot, filePath, functionsByFile.GetValueOrDefault(filePath) ?? [], containersByFile.GetValueOrDefault(filePath) ?? [], old));
        foreach (var filePath in status.Deleted) results.AddRange(ForDeletedFile(filePath, old));
        return results;
    }

    private static List<JsonObject> ForPresentFile(
        IGraphEngine engine, string repoRoot, string filePath, List<GraphNode> currentNodes, List<GraphNode> containerNodes, Dictionary<string, OldFile> oldFiles)
    {
        if (!oldFiles.TryGetValue(filePath, out var old)) return [];
        var currentText = SourceText.Read(Path.Combine(repoRoot, filePath));
        if (currentText is null) return [];
        var results = new List<JsonObject>();
        var currentIds = new HashSet<string>();

        foreach (var node in currentNodes)
        {
            if (engine.GetSymbol(node.Id) is not { } symbol) continue;
            currentIds.Add(node.Id);
            var proposed = SourceText.SliceLines(currentText, symbol.StartLine, symbol.EndLine);
            var oldSymbol = old.Functions.GetValueOrDefault(node.Id);
            var original = oldSymbol is null ? "" : SourceText.SliceLines(old.SliceText, oldSymbol.StartLine, oldSymbol.EndLine);
            if (original == proposed) continue;
            results.Add(Entry(node.Id, node.Name, oldSymbol is null ? "added" : "modified", original, proposed));
        }
        foreach (var (symbolId, oldSymbol) in old.Functions)
        {
            if (currentIds.Contains(symbolId)) continue;
            results.Add(Entry(symbolId, oldSymbol.Name, "deleted", SourceText.SliceLines(old.SliceText, oldSymbol.StartLine, oldSymbol.EndLine), ""));
        }
        results.AddRange(ContainerDiffs(engine, currentText, old, containerNodes, hasFunction: results.Count > 0));

        // A present, changed file gets its own file-level entry so the file's canvas block shows its whole-text diff.
        if (old.Existed && currentText != old.Text)
            results.Add(Entry($"component::{filePath}", Path.GetFileName(filePath), "modified", old.Text, currentText, "file"));
        return results;
    }

    private static List<JsonObject> ContainerDiffs(IGraphEngine engine, string currentText, OldFile old, List<GraphNode> containerNodes, bool hasFunction)
    {
        var results = new List<JsonObject>();
        foreach (var node in containerNodes)
        {
            if (node.Level == HierarchyLevel.Component)
            {
                if (old.Existed) continue;
                results.Add(Entry(node.Id, node.Name, "added", "", currentText, "file"));
                continue;
            }
            if (engine.GetSymbol(node.Id) is not { } symbol) continue;
            var proposed = SourceText.SliceLines(currentText, symbol.StartLine, symbol.EndLine);
            var oldSymbol = old.Containers.GetValueOrDefault(node.Id);
            if (!old.Existed || oldSymbol is null)
            {
                results.Add(Entry(node.Id, node.Name, "added", "", proposed, "class"));
                continue;
            }
            if (hasFunction) continue;
            var original = SourceText.SliceLines(old.SliceText, oldSymbol.StartLine, oldSymbol.EndLine);
            if (original == proposed) continue;
            results.Add(Entry(node.Id, node.Name, "modified", original, proposed, "class"));
        }
        return results;
    }

    /// <summary>Every FUNCTION the base had in a file that no longer exists on disk, as a 'deleted' diff.</summary>
    private static List<JsonObject> ForDeletedFile(string filePath, Dictionary<string, OldFile> oldFiles) =>
        !oldFiles.TryGetValue(filePath, out var old)
            ? []
            : old.Functions.Select(kv => Entry(kv.Key, kv.Value.Name, "deleted", SourceText.SliceLines(old.SliceText, kv.Value.StartLine, kv.Value.EndLine), "")).ToList();

    private static JsonObject Entry(string nodeId, string name, string status, string original, string proposed, string level = "function") => new()
    {
        ["node_id"] = nodeId,
        ["name"] = name,
        ["status"] = status,
        ["original_source"] = original,
        ["proposed_source"] = proposed,
        ["level"] = level,
    };

    /// <summary>FUNCTION and COMPONENT/SERVICE nodes, each grouped by source path, in one graph walk.</summary>
    private static (Dictionary<string, List<GraphNode>> Functions, Dictionary<string, List<GraphNode>> Containers) FunctionsAndContainersBySourcePath(IGraphEngine engine)
    {
        var functions = new List<GraphNode>();
        var containers = new List<GraphNode>();
        var visited = new HashSet<string>();

        void Walk(string nodeId)
        {
            foreach (var child in engine.GetChildren(nodeId))
            {
                // Multi-parenting means a node can be reached twice; CODE leaves are never of interest.
                if (child.Level == HierarchyLevel.Code || !visited.Add(child.Id)) continue;
                if (child.Level == HierarchyLevel.Function) functions.Add(child);
                else if (child.Level is HierarchyLevel.Component or HierarchyLevel.Service) containers.Add(child);
                // Nothing below a FUNCTION is a function or a container, so stop descending there.
                if (child.Level != HierarchyLevel.Function) Walk(child.Id);
            }
        }

        Walk(IGraphEngine.RootSentinel);
        return (BySourcePath(functions), BySourcePath(containers));
    }

    private static Dictionary<string, List<GraphNode>> BySourcePath(List<GraphNode> nodes)
    {
        var byFile = new Dictionary<string, List<GraphNode>>();
        foreach (var node in nodes.Where(n => !string.IsNullOrEmpty(n.SourcePath)))
        {
            if (!byFile.TryGetValue(node.SourcePath!, out var list)) byFile[node.SourcePath!] = list = [];
            list.Add(node);
        }
        return byFile;
    }
}
