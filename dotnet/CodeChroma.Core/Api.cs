using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace CodeChroma.Core;

public sealed record BuildResult(IReadOnlyList<HierarchyNode> Nodes, IReadOnlyList<Symbol> Symbols);

public static class GraphBuilder
{
    public static BuildResult Build(IReadOnlyList<FileSymbols> files, IImportResolver? resolver = null) =>
        throw new NotImplementedException();

    public static string? SymbolOrigin(Symbol? symbol) => throw new NotImplementedException();
}

public static class GraphDiffer
{
    public static GraphDiff Diff(Graph before, Graph after) => throw new NotImplementedException();
}

public sealed record DigestCaps
{
    public int MaxCalleesPerSymbol { get; init; } = 12;
    public int MaxCallersPerSymbol { get; init; } = 12;
    public int MaxImportsPerFile { get; init; } = 20;
    public int TrivialMaxBodyLines { get; init; } = 2;
    public int MaxDetailedFiles { get; init; } = 500;
    public int MaxTotalSymbolEntries { get; init; } = 6000;
}

/// <summary>Reverses every node's DependsOnIds once so "who calls this" is an O(1) lookup.</summary>
public sealed class DependencyIndex
{
    public const int RouteHopCap = 12;

    public DependencyIndex(Graph graph) => throw new NotImplementedException();

    public IReadOnlyList<string> DependenciesOf(string nodeId) => throw new NotImplementedException();
    public IReadOnlyList<string> DependentsOf(string nodeId) => throw new NotImplementedException();
    public IReadOnlyList<string>? FindRoute(string fromId, string toId) => throw new NotImplementedException();
    public IEnumerable<(string From, string To)> Edges() => throw new NotImplementedException();
}

public static class DependencyDigest
{
    public const string FileName = "dependency-digest.json";

    public static JsonObject Build(Graph graph, DigestCaps? caps = null, DependencyIndex? index = null) =>
        throw new NotImplementedException();

    public static string PathFor(string repoRoot) => throw new NotImplementedException();
    public static JsonObject Load(string repoRoot) => throw new NotImplementedException();
    public static void Write(string repoRoot, JsonObject digest) => throw new NotImplementedException();
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

public static class Clustering
{
    public const string RootFolder = "<root>";

    public static bool IsInfraPath(string path) => throw new NotImplementedException();
    public static string? PluralityWinner(IReadOnlyDictionary<string, int> votes) => throw new NotImplementedException();
    public static ClusterResult Build(Graph graph, IImportResolver resolver) => throw new NotImplementedException();
    public static IReadOnlyDictionary<(string, string), int> FileEdgeWeights(Graph graph) =>
        throw new NotImplementedException();
    public static IReadOnlyList<UndeterminedCandidate> UndeterminedCandidates(
        string file, ClusterResult result, int limit = 3) => throw new NotImplementedException();
}

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

public static class StructureBuilder
{
    public static StructureResult Build(Graph graph, StructureOptions? options = null) =>
        throw new NotImplementedException();
}

public static class ContextDigest
{
    public static JsonObject Build(Graph graph, string repoRoot) => throw new NotImplementedException();
}

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

public sealed class GraphCore(IGraphSink? sink = null) : IGraphCore
{
    public Graph Snapshot => throw new NotImplementedException();
    public AnalysisRunResult Analyze(AnalysisInput input) => throw new NotImplementedException();
    public AnalysisRunResult Reanalyze(AnalysisDelta delta) => throw new NotImplementedException();
    public HierarchyNode? GetNode(string nodeId) => throw new NotImplementedException();
    public IReadOnlyList<HierarchyNode> GetChildren(string nodeId) => throw new NotImplementedException();
    public IReadOnlyList<HierarchyNode> GetDependencies(string nodeId) => throw new NotImplementedException();
    public IReadOnlyList<HierarchyNode> GetDependents(string nodeId) => throw new NotImplementedException();
}
