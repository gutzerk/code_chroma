using System.Text.Json.Nodes;
using CodeChroma.Bridge.Engine;

namespace CodeChroma.Bridge.Diagrams;

/// <summary>The deterministic Impact slice: seed nodes, one hop of callers/callees, and the edges inside it (bridge/impact.py).</summary>
public static class ImpactSlice
{
    public static JsonObject Resolve(IGraphEngine engine, IEnumerable<string> nodeIds, int hop = 1, int maxNodes = 200)
    {
        var seeds = nodeIds.Where(id => engine.GetNode(id) is not null).Distinct().Order(StringComparer.Ordinal).ToList();
        var seedSet = seeds.ToHashSet();
        var members = new HashSet<string>(seeds);
        var frontier = seeds;
        for (var step = 0; step < Math.Max(0, hop); step++)
        {
            if (members.Count >= maxNodes) break;
            var next = new List<string>();
            foreach (var nodeId in frontier)
                foreach (var neighbour in Neighbours(engine, nodeId))
                {
                    if (!members.Add(neighbour)) continue;
                    next.Add(neighbour);
                    if (members.Count >= maxNodes) break;
                }
            frontier = next;
            if (frontier.Count == 0) break;
        }

        var ordered = members.Order(StringComparer.Ordinal).ToList();
        var nodes = ordered.Select(id => (JsonNode?)new JsonObject
        {
            ["id"] = id,
            ["name"] = engine.GetNode(id)?.Name ?? id,
            ["seed"] = seedSet.Contains(id),
            ["node_id"] = id,
        }).ToArray();
        var relations = ordered
            .SelectMany(id => DependencyIds(engine, id).Where(dep => members.Contains(dep) && dep != id).Select(dep => (JsonNode?)new JsonObject { ["from"] = id, ["to"] = dep }))
            .ToArray();
        return new JsonObject
        {
            ["nodes"] = new JsonArray(nodes),
            ["relations"] = new JsonArray(relations),
            ["seed_count"] = seeds.Count,
            ["node_count"] = nodes.Length,
            ["truncated"] = members.Count >= maxNodes,
        };
    }

    private static IEnumerable<string> DependencyIds(IGraphEngine engine, string id) =>
        engine.GetDependencies(id).Select(n => n.Id).Distinct().Order(StringComparer.Ordinal);

    private static IEnumerable<string> Neighbours(IGraphEngine engine, string id) =>
        DependencyIds(engine, id).Concat(engine.GetDependents(id).Select(n => n.Id)).Distinct().Order(StringComparer.Ordinal);
}
