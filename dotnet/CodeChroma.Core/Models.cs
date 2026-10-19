using System.Text.Json;
using System.Text.Json.Serialization;

namespace CodeChroma.Core;

public enum HierarchyLevel { System, Pillar, Component, Service, Function, LogicBlock, Code }

public enum SymbolKind { Module, Class, Function, Variable }

/// <summary>A call like <c>m.z()</c>: the qualifier's raw text plus the called name.</summary>
public sealed record QualifiedReference(string Qualifier, string Name);

/// <summary>One direct statement of a function body: its grammar node type and line span.</summary>
public sealed record BodyStatement(string Type, int StartLine, int EndLine);

/// <summary>A parsed unit of code (module/class/function/variable), as emitted by an analyzer.</summary>
public sealed record Symbol
{
    public required string Id { get; init; }
    public required string FilePath { get; init; }
    public required SymbolKind Kind { get; init; }
    public required string Name { get; init; }
    public string QualifiedName { get; init; } = "";
    public int StartLine { get; init; }
    public int EndLine { get; init; }
    public string Language { get; init; } = "";
    public string? ParentSymbolId { get; init; }
    public IReadOnlyList<string> References { get; init; } = [];
    public IReadOnlyList<QualifiedReference> QualifiedReferences { get; init; } = [];
    public IReadOnlyList<string> AssignedIdentifiers { get; init; } = [];
    public IReadOnlyDictionary<string, string> Imports { get; init; } = new Dictionary<string, string>();
    public IReadOnlyList<BodyStatement> BodyStatements { get; init; } = [];
    public string? Docstring { get; init; }
    public bool IsExported { get; init; }
}

public sealed record HierarchyNode
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required HierarchyLevel Level { get; init; }
    public IReadOnlyList<string> ParentIds { get; init; } = [];
    public string? SourcePath { get; init; }
    public IReadOnlyList<string> SymbolIds { get; init; } = [];
    public string? RepositoryId { get; init; }
    public IReadOnlyList<string> DependsOnIds { get; init; } = [];
    public bool DocOnly { get; init; }
}

public sealed record GraphDiff(
    IReadOnlyList<string> AddedNodeIds,
    IReadOnlyList<string> RemovedNodeIds,
    IReadOnlyList<ReparentedNode> ReparentedNodeIds);

public sealed record ReparentedNode(string NodeId, IReadOnlyList<string> OldParentIds, IReadOnlyList<string> NewParentIds);

public sealed record AnalysisRunResult(string Status, GraphDiff Diff);

/// <summary>Immutable graph snapshot with O(1) lookups by id and a parent-to-children index.</summary>
public sealed class Graph
{
    public const string RootSentinel = "__root__";

    private readonly Lazy<Dictionary<string, List<HierarchyNode>>> _children;

    public Graph(
        IReadOnlyList<HierarchyNode> nodes,
        IReadOnlyList<Symbol> symbols,
        IReadOnlyDictionary<string, string>? summaries = null)
    {
        NodeList = nodes;
        SymbolList = symbols;
        Summaries = summaries ?? new Dictionary<string, string>();
        Nodes = nodes.ToDictionary(n => n.Id);
        Symbols = symbols.ToDictionary(s => s.Id);
        _children = new Lazy<Dictionary<string, List<HierarchyNode>>>(BuildChildren);
    }

    /// <summary>Nodes in builder order (the order is part of the parity contract).</summary>
    public IReadOnlyList<HierarchyNode> NodeList { get; }
    public IReadOnlyList<Symbol> SymbolList { get; }
    public IReadOnlyDictionary<string, HierarchyNode> Nodes { get; }
    public IReadOnlyDictionary<string, Symbol> Symbols { get; }
    public IReadOnlyDictionary<string, string> Summaries { get; }

    public IReadOnlyList<HierarchyNode> ChildrenOf(string nodeId) =>
        _children.Value.TryGetValue(nodeId, out var list) ? list : [];

    private Dictionary<string, List<HierarchyNode>> BuildChildren()
    {
        var index = new Dictionary<string, List<HierarchyNode>>();
        foreach (var node in NodeList)
        {
            var parents = node.ParentIds.Count == 0 ? [RootSentinel] : node.ParentIds;
            foreach (var parentId in parents)
            {
                if (!index.TryGetValue(parentId, out var list)) index[parentId] = list = [];
                list.Add(node);
            }
        }
        return index;
    }
}

/// <summary>The one JSON dialect shared by the analyzer contract and every golden file.</summary>
public static class WireJson
{
    public static readonly JsonSerializerOptions Options = Create();

    private static JsonSerializerOptions Create()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
            DictionaryKeyPolicy = null,
            DefaultIgnoreCondition = JsonIgnoreCondition.Never,
        };
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower));
        return options;
    }
}
