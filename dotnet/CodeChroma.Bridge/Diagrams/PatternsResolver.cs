using System.Text.Json.Nodes;
using CodeChroma.Bridge.Engine;
using CodeChroma.Bridge.Stores;
using CodeChroma.Core.Patterns;

namespace CodeChroma.Bridge.Diagrams;

/// <summary>Merges the graph's always-fresh pattern candidates with the authored patterns.json; mirrors bridge/patterns_resolver.py.</summary>
public static class PatternsResolver
{
    private static readonly string[] FreeNodeKinds = ["infra", "external"];
    private static readonly string[] InstanceOverlayFields = ["name", "description"];
    private static readonly string[] ParticipantOverlayFields = ["description", "style"];

    /// <summary>The candidates reshaped into the shared flat nodes[]/relations[] diagram shape.</summary>
    public static (List<JsonObject> Nodes, List<JsonObject> Relations) ToSharedDiagram(IEnumerable<PatternInstance> candidates)
    {
        var nodes = new List<JsonObject>();
        var relations = new List<JsonObject>();
        var seen = new HashSet<string>();
        foreach (var instance in candidates)
        {
            var serialized = PatternSerialize.SerializeInstance(instance);
            nodes.Add(PatternSerialize.InstanceNode(serialized));
            foreach (var participant in serialized["participants"]!.AsArray().OfType<JsonObject>())
            {
                if (!seen.Add(Json.Str(participant["id"])!)) continue;
                nodes.Add(PatternSerialize.ParticipantNode(participant, instance.Id));
            }
            relations.AddRange(serialized["relations"]!.AsArray().OfType<JsonObject>().Select(r => (JsonObject)r.DeepClone()));
        }
        return (nodes, relations);
    }

    private static Dictionary<string, HashSet<string>> NodeIdsByParent(IEnumerable<JsonObject> nodes)
    {
        var byParent = new Dictionary<string, HashSet<string>>();
        foreach (var node in nodes)
        {
            if (Json.Str(node["parent"]) is not { } parent || Json.Str(node["node_id"]) is not { } nodeId) continue;
            if (!byParent.TryGetValue(parent, out var set)) byParent[parent] = set = [];
            set.Add(nodeId);
        }
        return byParent;
    }

    private static JsonObject? BestInstanceMatch(
        HashSet<string> nodeIds, Dictionary<string, JsonObject> candidates, HashSet<string> matched,
        Dictionary<string, HashSet<string>> persistedChildren)
    {
        if (nodeIds.Count == 0) return null;
        JsonObject? best = null;
        var bestOverlap = 0;
        foreach (var (candidateId, entry) in candidates)
        {
            if (matched.Contains(candidateId)) continue;
            var overlap = persistedChildren.TryGetValue(candidateId, out var children) ? nodeIds.Count(children.Contains) : 0;
            if (overlap > bestOverlap) (best, bestOverlap) = (entry, overlap);
        }
        return best;
    }

    private static JsonObject Overlay(JsonObject item, JsonObject entry)
    {
        var merged = (JsonObject)item.DeepClone();
        if (Json.Str(item["kind"]) == PatternSerialize.InstanceKind)
        {
            foreach (var field in InstanceOverlayFields)
                if (Json.Truthy(entry[field])) merged[field] = entry[field]!.DeepClone();
            var entryMeta = entry["meta"] as JsonObject ?? [];
            var mergedMeta = merged["meta"] is JsonObject m ? (JsonObject)m.DeepClone() : new JsonObject();
            foreach (var key in new[] { "confirmed", "confidence" })
                if (entryMeta.ContainsKey(key)) mergedMeta[key] = entryMeta[key]?.DeepClone();
            merged["meta"] = mergedMeta;
        }
        else
        {
            foreach (var field in ParticipantOverlayFields)
                if (entry.ContainsKey(field)) merged[field] = entry[field]?.DeepClone();
        }
        return merged;
    }

    private static (List<JsonObject> Merged, HashSet<string> Matched) MergePatterns(List<JsonObject> current, List<JsonObject> persisted)
    {
        var persistedById = new Dictionary<string, JsonObject>();
        foreach (var item in persisted)
            if (Json.Str(item["id"]) is { } id) persistedById[id] = item;
        var instanceCandidates = persistedById.Where(p => Json.Str(p.Value["kind"]) == PatternSerialize.InstanceKind)
            .ToDictionary(p => p.Key, p => p.Value);
        var currentChildren = NodeIdsByParent(current);
        var persistedChildren = NodeIdsByParent(persisted);

        var matched = new HashSet<string>();
        var merged = new List<JsonObject>();
        foreach (var item in current)
        {
            var itemId = Json.Str(item["id"])!;
            persistedById.TryGetValue(itemId, out var entry);
            if (entry is null && Json.Str(item["kind"]) == PatternSerialize.InstanceKind)
                entry = BestInstanceMatch(currentChildren.GetValueOrDefault(itemId) ?? [], instanceCandidates, matched, persistedChildren);
            if (entry is null) { merged.Add(item); continue; }
            matched.Add(Json.Str(entry["id"])!);
            merged.Add(Overlay(item, entry));
        }
        return (merged, matched);
    }

    private static List<JsonObject> DropRejected(List<JsonObject> nodes)
    {
        var rejected = nodes
            .Where(n => Json.Str(n["kind"]) == PatternSerialize.InstanceKind
                && n["meta"] is JsonObject meta && meta["confirmed"] is JsonValue v && v.TryGetValue(out bool confirmed) && !confirmed)
            .Select(n => Json.Str(n["id"])!).ToHashSet();
        return nodes.Where(n => !rejected.Contains(Json.Str(n["id"])!) && !(Json.Str(n["parent"]) is { } p && rejected.Contains(p))).ToList();
    }

    private static bool KeepFreeNode(JsonObject item, Diagnostics notes)
    {
        var isFree = item["parent"] is null && Json.Str(item["kind"]) != PatternSerialize.InstanceKind;
        if (!isFree || FreeNodeKinds.Contains(Json.Str(item["kind"]))) return true;
        notes.Drop("node", Json.Str(item["id"]), "unknown_kind", Json.Str(item["kind"]) ?? "");
        return false;
    }

    public static JsonObject Resolve(IGraphEngine engine, JsonObject authored)
    {
        var candidates = engine.PatternCandidates();
        var (currentNodes, candidateRelations) = ToSharedDiagram(candidates);
        var persistedNodes = (authored["nodes"] as JsonArray ?? []).OfType<JsonObject>().Where(n => Json.Str(n["id"]) is not null).ToList();

        var (merged, matched) = MergePatterns(currentNodes, persistedNodes);
        var kindNotes = new Diagnostics();
        var leftovers = persistedNodes.Where(n => !matched.Contains(Json.Str(n["id"])!)).Where(n => KeepFreeNode(n, kindNotes)).Select(n => (JsonObject)n.DeepClone()).ToList();
        var allNodes = DropRejected([.. merged, .. leftovers]);

        var surviving = allNodes.Select(n => Json.Str(n["id"])!).ToHashSet();
        var relations = candidateRelations.Concat((authored["relations"] as JsonArray ?? []).OfType<JsonObject>())
            .Where(r => Json.Str(r["from"]) is { } from && Json.Str(r["to"]) is { } to && surviving.Contains(from) && surviving.Contains(to))
            .Select(r => (JsonNode?)r.DeepClone()).ToArray();

        var data = new JsonObject
        {
            ["type"] = "patterns",
            ["style"] = authored["style"]?.DeepClone(),
            ["nodes"] = new JsonArray(allNodes.Select(n => (JsonNode?)n).ToArray()),
            ["relations"] = new JsonArray(relations),
            ["generated_at"] = authored["generated_at"]?.DeepClone(),
        };
        // The authored display title rides through so the canvas can name this diagram.
        if (authored.ContainsKey("title")) data["title"] = authored["title"]?.DeepClone();
        var overrides = DiagramStyles.Overrides(data["style"]);
        overrides["allow_self_relations"] = true;
        var resolved = DiagramResolver.Resolve(engine, data, overrides);
        resolved["diagnostics"] = Diagnostics.Merge(resolved["diagnostics"], kindNotes.AsPayload());
        resolved["has_diagram"] = authored.Count > 0;
        return DiagramResolver.AttachStaleness(resolved, PatternSerialize.FingerprintFor(candidates), Json.Str(authored["fingerprint"]));
    }
}
