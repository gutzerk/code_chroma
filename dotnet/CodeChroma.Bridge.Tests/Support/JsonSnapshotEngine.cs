using System.Text.Json.Nodes;
using CodeChroma.Bridge.Engine;

namespace CodeChroma.Bridge.Tests.Support;

/// <summary>An IGraphEngine over the Python engine's dumped graph (scripts/dump_bridge_contract_snapshot.py).</summary>
public sealed class JsonSnapshotEngine : IGraphEngine
{
    private readonly Dictionary<string, GraphNode> _nodes = new();
    private readonly Dictionary<string, SymbolInfo> _symbols = new();
    private readonly Dictionary<string, string> _summaries = new();
    private readonly Dictionary<string, List<GraphNode>> _children = new();

    public List<IReadOnlyList<string>> Reanalyzed { get; } = [];

    /// <summary>The hand-built graph and grouping a wiki-general test serves; null leaves the engine without one.</summary>
    public CodeChroma.Core.Graph? Graph { get; set; }

    public CodeChroma.Core.ClusterResult? Clusters { get; set; }

    public CodeChroma.Core.Graph? GraphSnapshot() => Graph;

    public CodeChroma.Core.ClusterResult? BuildClusters(string repoRoot) => Clusters;

    public JsonSnapshotEngine(string snapshotPath)
    {
        var doc = JsonNode.Parse(File.ReadAllText(snapshotPath))!.AsObject();
        foreach (var n in doc["nodes"]!.AsArray())
        {
            var o = n!.AsObject();
            var node = new GraphNode(
                o["id"]!.GetValue<string>(),
                o["name"]!.GetValue<string>(),
                Enum.Parse<HierarchyLevel>(o["level"]!.GetValue<string>().Replace("_", ""), ignoreCase: true),
                Strings(o["parent_ids"]),
                o["source_path"]?.GetValue<string>(),
                o["doc_only"]!.GetValue<bool>(),
                Strings(o["depends_on_ids"]));
            _nodes[node.Id] = node;
            foreach (var parent in node.ParentIds.Count == 0 ? [IGraphEngine.RootSentinel] : node.ParentIds)
            {
                if (!_children.TryGetValue(parent, out var list)) _children[parent] = list = [];
                list.Add(node);
            }
        }
        foreach (var s in doc["symbols"]!.AsArray())
        {
            var o = s!.AsObject();
            var symbol = new SymbolInfo(
                o["id"]!.GetValue<string>(), o["file_path"]!.GetValue<string>(),
                o["start_line"]!.GetValue<int>(), o["end_line"]!.GetValue<int>(), o["language"]!.GetValue<string>());
            _symbols[symbol.Id] = symbol;
        }
        foreach (var kv in doc["summaries"]!.AsObject()) _summaries[kv.Key] = kv.Value!.GetValue<string>();
    }

    private static string[] Strings(JsonNode? node) => node!.AsArray().Select(x => x!.GetValue<string>()).ToArray();

    public GraphNode? GetNode(string id) => _nodes.GetValueOrDefault(id);

    public IReadOnlyList<GraphNode> GetChildren(string id) => _children.TryGetValue(id, out var list) ? list : [];

    public SymbolInfo? GetSymbol(string id) => _symbols.GetValueOrDefault(id);

    public IReadOnlyList<GraphNode> GetDependencies(string id) =>
        _nodes.TryGetValue(id, out var node)
            ? node.DependsOnIds.Where(_nodes.ContainsKey).Select(d => _nodes[d]).ToList()
            : [];

    public IReadOnlyList<GraphNode> GetDependents(string id) =>
        _nodes.Values.Where(n => n.DependsOnIds.Contains(id)).ToList();

    public string? SummaryText(string id) => _summaries.GetValueOrDefault(id);

    public void Reanalyze(IReadOnlyList<string> changedPaths) => Reanalyzed.Add(changedPaths);
}

public sealed class SnapshotEngineFactory(string snapshotPath) : IEngineFactory
{
    public IGraphEngine Create(string root) => new JsonSnapshotEngine(snapshotPath);
}
