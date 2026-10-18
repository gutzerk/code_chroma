using CodeChroma.Core;

namespace CodeChroma.Canvas.Hierarchy;

/// <summary>Adapts the C# graph core's snapshot to the canvas: wire level names, first parent, summary as description.</summary>
public sealed class CoreHierarchySource : IHierarchySource
{
    private readonly Graph _graph;

    public CoreHierarchySource(Graph graph) => _graph = graph;

    public HierarchyItem? Get(string id)
    {
        if (id == HierarchyIds.Root) return new HierarchyItem(HierarchyIds.Root, "root", "root", null, _graph.ChildrenOf(Graph.RootSentinel).Count > 0);
        return _graph.Nodes.TryGetValue(id, out var node) ? Map(node) : null;
    }

    public IReadOnlyList<HierarchyItem> Children(string id) =>
        _graph.ChildrenOf(id == HierarchyIds.Root ? Graph.RootSentinel : id).Select(Map).ToList();

    /// <summary>A function or class node is its own symbol (the node id is the symbol id); structural nodes have none.</summary>
    internal static Symbol? SymbolOf(Graph graph, HierarchyNode node) =>
        node.SymbolIds.Count > 0 && graph.Symbols.TryGetValue(node.SymbolIds[0], out var s) ? s
        : graph.Symbols.GetValueOrDefault(node.Id);

    /// <summary>Logic-block and code nodes carry "path:from-to" as their source path.</summary>
    internal static (string? Path, int From, int To) SplitSpan(string? sourcePath)
    {
        if (sourcePath is null) return (null, 0, 0);
        var colon = sourcePath.LastIndexOf(':');
        if (colon > 0)
        {
            var range = sourcePath[(colon + 1)..].Split('-');
            if (range.Length == 2 && int.TryParse(range[0], out var from) && int.TryParse(range[1], out var to))
                return (sourcePath[..colon], from, to);
        }
        return (sourcePath, 0, 0);
    }

    public static string LevelName(HierarchyLevel level) => level switch
    {
        HierarchyLevel.LogicBlock => "logic_block",
        _ => level.ToString().ToLowerInvariant(),
    };

    private HierarchyItem Map(HierarchyNode node)
    {
        var symbol = SymbolOf(_graph, node);
        return new HierarchyItem(
            node.Id, node.Name, LevelName(node.Level),
            node.ParentIds.Count > 0 ? node.ParentIds[0] : HierarchyIds.Root,
            _graph.ChildrenOf(node.Id).Count > 0,
            _graph.Summaries.GetValueOrDefault(node.Id),
            null,
            symbol?.FilePath ?? SplitSpan(node.SourcePath).Path,
            symbol?.Language,
            node.DocOnly);
    }
}

/// <summary>Serves function/file source by slicing the file text with the symbol's line span.</summary>
public sealed class CoreCodeSource : ICodeSource
{
    private readonly Graph _graph;
    private readonly Func<string, string?> _readFile;

    public CoreCodeSource(Graph graph, Func<string, string?> readFile)
    {
        _graph = graph;
        _readFile = readFile;
    }

    public CodeSnippet? Get(string nodeId)
    {
        if (!_graph.Nodes.TryGetValue(nodeId, out var node)) return null;
        var symbol = CoreHierarchySource.SymbolOf(_graph, node);
        var (spanPath, spanFrom, spanTo) = CoreHierarchySource.SplitSpan(node.SourcePath);
        var path = symbol?.FilePath ?? spanPath;
        if (path is null) return null;
        var text = _readFile(path);
        if (text is null) return null;
        var language = !string.IsNullOrEmpty(symbol?.Language) ? symbol!.Language : LanguageOfPath(path);
        var bySymbol = symbol is { Kind: not SymbolKind.Module, StartLine: > 0 };
        var start = bySymbol ? symbol!.StartLine : spanFrom;
        var end = bySymbol ? symbol!.EndLine : spanTo;
        if (start <= 0)
            return new CodeSnippet(nodeId, node.Name, null, language, text, 1);
        var lines = text.Replace("\r\n", "\n").Split('\n');
        var from = Math.Clamp(start, 1, lines.Length);
        var to = Math.Clamp(end, from, lines.Length);
        return new CodeSnippet(nodeId, node.Name, null, language, string.Join("\n", lines[(from - 1)..to]), from);
    }

    private static string LanguageOfPath(string path) => Path.GetExtension(path).TrimStart('.').ToLowerInvariant();
}
