using System.Text.Json.Serialization;

namespace CodeChroma.Core;

public sealed record BuildResult(IReadOnlyList<HierarchyNode> Nodes, IReadOnlyList<Symbol> Symbols);

public sealed record DigestCaps
{
    public int MaxCalleesPerSymbol { get; init; } = 12;
    public int MaxCallersPerSymbol { get; init; } = 12;
    public int MaxImportsPerFile { get; init; } = 20;
    public int TrivialMaxBodyLines { get; init; } = 2;
    public int MaxDetailedFiles { get; init; } = 500;
    public int MaxTotalSymbolEntries { get; init; } = 6000;
}

public sealed record ClusterEdge(string FromId, string ToId, int Count);
public sealed record ComponentCluster(string Id, string ContainerId, IReadOnlyList<string> Files);
public sealed record ContainerCluster(string Id, IReadOnlyList<string> ComponentIds);
public sealed record UndeterminedCandidate(string Id, IReadOnlyList<string> Files);

public sealed record ClusterResult(
    IReadOnlyList<ComponentCluster> Components,
    IReadOnlyList<ContainerCluster> Containers,
    IReadOnlyList<ClusterEdge> ComponentEdges,
    IReadOnlyList<ClusterEdge> ContainerEdges,
    IReadOnlyList<string> UndeterminedFiles,
    IReadOnlyDictionary<(string, string), int> FileEdgeWeights);

public sealed record StructureOptions(string RootId = "root", int? Depth = null, int? MaxChildren = null, int? MaxNodes = null);

public sealed class StructureEntry
{
    public required string NodeId { get; init; }
    public required string Path { get; init; }
    public required string Name { get; init; }
    public required string Level { get; init; }
    public string? Summary { get; init; }
    public bool DocOnly { get; init; }
    public int ChildCount { get; set; }
    public bool Truncated { get; set; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public List<StructureEntry>? Children { get; set; }
}

public sealed record StructureResult(string Root, int Depth, bool Truncated, IReadOnlyList<StructureEntry> Nodes);

public sealed class UnknownRootException(string rootId) : Exception($"no graph node for root '{rootId}'");

/// <summary>Receives every graph the core produces, e.g. to persist the dependency digest.</summary>
public interface IGraphSink
{
    void OnGraph(Graph graph);
}

public sealed record AnalysisDelta(
    IReadOnlyList<FileSymbols> Changed,
    IReadOnlyList<string> Removed,
    IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>>? ImportResolutions = null);

/// <summary>The graph core's public surface: the compile-time replacement for the Python contract test.</summary>
public interface IGraphCore
{
    AnalysisRunResult Analyze(AnalysisInput input);
    AnalysisRunResult Reanalyze(AnalysisDelta delta);
    HierarchyNode? GetNode(string nodeId);
    IReadOnlyList<HierarchyNode> GetChildren(string nodeId);
    IReadOnlyList<HierarchyNode> GetDependencies(string nodeId);
    IReadOnlyList<HierarchyNode> GetDependents(string nodeId);
    Graph Snapshot { get; }
}
