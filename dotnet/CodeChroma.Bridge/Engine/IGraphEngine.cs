namespace CodeChroma.Bridge.Engine;

public enum HierarchyLevel { System, Pillar, Component, Service, Function, LogicBlock, Code }

public sealed record GraphNode(
    string Id,
    string Name,
    HierarchyLevel Level,
    IReadOnlyList<string> ParentIds,
    string? SourcePath,
    bool DocOnly,
    IReadOnlyList<string> DependsOnIds);

public sealed record SymbolInfo(string Id, string FilePath, int StartLine, int EndLine, string Language);

/// <summary>The narrow surface the bridge needs from the graph core (CodeChroma.Core plugs in here).</summary>
public interface IGraphEngine
{
    public const string RootSentinel = "__root__";

    GraphNode? GetNode(string id);

    /// <summary>Children of a node id, or of <see cref="RootSentinel"/> for top-level nodes, in engine order.</summary>
    IReadOnlyList<GraphNode> GetChildren(string id);

    SymbolInfo? GetSymbol(string id);

    IReadOnlyList<GraphNode> GetDependencies(string id);

    IReadOnlyList<GraphNode> GetDependents(string id);

    string? SummaryText(string id);

    void Reanalyze(IReadOnlyList<string> changedPaths);
}

public interface IEngineFactory
{
    /// <summary>Analyzes <paramref name="root"/> and returns a ready engine.</summary>
    IGraphEngine Create(string root);
}
