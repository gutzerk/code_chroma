using System.Text.Json;

namespace CodeChroma.Core;

public static class AnalysisInputReader
{
    public const int SupportedSchemaVersion = 1;

    public static AnalysisInput Parse(string json)
    {
        var input = JsonSerializer.Deserialize<AnalysisInput>(json, WireJson.Options)
            ?? throw new JsonException("analysis input is empty");
        if (input.SchemaVersion != SupportedSchemaVersion) throw new UnsupportedSchemaException(input.SchemaVersion);
        return input;
    }

    public static AnalysisInput Load(string path) => Parse(File.ReadAllText(path));
}

public static class GraphDiffer
{
    /// <summary>Added, removed and reparented node ids between two snapshots (a value diff, not read from storage).</summary>
    public static GraphDiff Diff(Graph before, Graph after)
    {
        var added = after.Nodes.Keys.Where(id => !before.Nodes.ContainsKey(id)).Order(StringComparer.Ordinal).ToList();
        var removed = before.Nodes.Keys.Where(id => !after.Nodes.ContainsKey(id)).Order(StringComparer.Ordinal).ToList();
        var reparented = new List<ReparentedNode>();
        foreach (var id in before.Nodes.Keys.Where(after.Nodes.ContainsKey).Order(StringComparer.Ordinal))
        {
            var (oldParents, newParents) = (before.Nodes[id].ParentIds, after.Nodes[id].ParentIds);
            if (!oldParents.Order(StringComparer.Ordinal).SequenceEqual(newParents.Order(StringComparer.Ordinal)))
                reparented.Add(new ReparentedNode(id, oldParents, newParents));
        }
        return new GraphDiff(added, removed, reparented);
    }
}

/// <summary>Builds and serves the hierarchy graph from analyzer output; the C# counterpart of the graph half of GraphEngine.</summary>
public sealed class GraphCore(IGraphSink? sink = null, IImportResolver? liveResolver = null) : IGraphCore
{
    private sealed record State(Graph Graph, DependencyIndex Index);

    private static readonly Graph Empty = new([], []);

    private readonly OrderedMap<string, FileSymbols> _files = new();
    private readonly Dictionary<string, IReadOnlyDictionary<string, string>> _resolutions = [];
    private IReadOnlyDictionary<string, string> _summaries = new Dictionary<string, string>();
    private volatile State? _state;

    /// <summary>Raised when the sink throws; a sink bug must never fail an otherwise-successful run.</summary>
    public event Action<Exception>? SinkFailed;

    public Graph Snapshot => _state?.Graph ?? Empty;

    public AnalysisRunResult Analyze(AnalysisInput input)
    {
        _files.Clear();
        foreach (var file in input.Files) _files[file.Path] = file;
        _resolutions.Clear();
        foreach (var (importer, table) in input.ImportResolutions) _resolutions[importer] = table;
        _summaries = input.Summaries;
        return Rebuild();
    }

    public AnalysisRunResult Reanalyze(AnalysisDelta delta)
    {
        if (_state is null) throw new InvalidOperationException("Reanalyze() requires a prior Analyze() call");
        foreach (var path in delta.Removed)
        {
            _files.Remove(path);
            _resolutions.Remove(path);
        }
        foreach (var file in delta.Changed)
        {
            _files[file.Path] = file;
            if (delta.ImportResolutions is not null && delta.ImportResolutions.TryGetValue(file.Path, out var table))
                _resolutions[file.Path] = table;
            else
                _resolutions.Remove(file.Path);
        }
        ReResolveImports();
        return Rebuild();
    }

    /// <summary>Re-resolves every import against the live tree so a new or deleted target file changes edges in unchanged importers.</summary>
    private void ReResolveImports()
    {
        if (liveResolver is null) return;
        foreach (var file in _files.Values)
        {
            var fresh = new Dictionary<string, string>();
            foreach (var symbol in file.Symbols ?? [])
            {
                if (symbol.Kind != SymbolKind.Module) continue;
                foreach (var dotted in symbol.Imports.Values.Distinct())
                    if (liveResolver.Resolve(file.Path, dotted) is { } target) fresh[dotted] = target;
            }
            if (fresh.Count > 0) _resolutions[file.Path] = fresh;
            else _resolutions.Remove(file.Path);
        }
    }

    public HierarchyNode? GetNode(string nodeId) => Snapshot.Nodes.GetValueOrDefault(nodeId);

    public IReadOnlyList<HierarchyNode> GetChildren(string nodeId) => Snapshot.ChildrenOf(nodeId);

    public IReadOnlyList<HierarchyNode> GetDependencies(string nodeId) =>
        _state is not { } s ? [] : s.Index.DependenciesOf(nodeId).Select(id => s.Graph.Nodes[id]).ToList();

    public IReadOnlyList<HierarchyNode> GetDependents(string nodeId) =>
        _state is not { } s ? [] : s.Index.DependentsOf(nodeId).Select(id => s.Graph.Nodes[id]).ToList();

    private AnalysisRunResult Rebuild()
    {
        var before = Snapshot;
        var built = GraphBuilder.Build(_files.Values.ToList(), new TableImportResolver(_resolutions));
        var nodes = built.Nodes.Count > 0
            ? built.Nodes
            : [new HierarchyNode { Id = "system::__empty__", Name = "repository", Level = HierarchyLevel.System }];
        var graph = new Graph(nodes, built.Symbols, _summaries);
        _state = new State(graph, new DependencyIndex(graph));
        NotifySink(graph);
        return new AnalysisRunResult("succeeded", GraphDiffer.Diff(before, graph));
    }

    private void NotifySink(Graph graph)
    {
        try
        {
            sink?.OnGraph(graph);
        }
        catch (Exception e)
        {
            SinkFailed?.Invoke(e);
        }
    }
}
