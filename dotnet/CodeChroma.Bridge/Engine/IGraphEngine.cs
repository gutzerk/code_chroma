namespace CodeChroma.Bridge.Engine;

public enum HierarchyLevel { System, Pillar, Component, Service, Function, LogicBlock, Code }

public sealed record GraphNode(
    string Id,
    string Name,
    HierarchyLevel Level,
    IReadOnlyList<string> ParentIds,
    string? SourcePath,
    bool DocOnly,
    IReadOnlyList<string> DependsOnIds,
    IReadOnlyList<string>? SymbolIds = null);

public sealed record SymbolInfo(string Id, string FilePath, int StartLine, int EndLine, string Language, string QualifiedName = "");

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

    /// <summary>The innermost function node whose line span holds <paramref name="line"/> in a repo-relative file, or null.</summary>
    string? FunctionNodeAtLine(string relPath, int line) => null;

    void Reanalyze(IReadOnlyList<string> changedPaths);

    /// <summary>The engine's current Graph for whole-graph consumers (the wiki); null for engines without one.</summary>
    CodeChroma.Core.Graph? GraphSnapshot() => null;

    /// <summary>The heuristic design-pattern candidates for the current graph; engines without shape support report none.</summary>
    IReadOnlyList<CodeChroma.Core.Patterns.PatternInstance> PatternCandidates() => [];

    /// <summary>The patterns skill's {classes, heuristic_candidates} payload; null for engines without shape support.</summary>
    System.Text.Json.Nodes.JsonObject? PatternsContext() => null;
}

public interface IEngineFactory
{
    /// <summary>Analyzes <paramref name="root"/> and returns a ready engine.</summary>
    IGraphEngine Create(string root);
}

/// <summary>Placeholder until CodeChroma.Core lands: the bridge boots, but no repository can be analyzed.</summary>
public sealed class UnavailableEngineFactory : IEngineFactory
{
    public IGraphEngine Create(string root) =>
        throw new NotSupportedException("no graph engine is wired in yet; register an IEngineFactory backed by CodeChroma.Core");
}
