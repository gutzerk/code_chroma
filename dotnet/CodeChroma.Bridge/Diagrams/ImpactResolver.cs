using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Diagrams;

/// <summary>Serves the authored impact.json to the canvas, validated and flagged stale against the live slice (bridge/impact_resolver.py).</summary>
public static class ImpactResolver
{
    // The only four plan roles that spell a colour or chip; anything else is dropped, never mis-coloured.
    private static readonly string[] PlanStatuses = ["new", "modified", "deleted", "context"];

    /// <summary>Impact's own, stricter rule: a box with no already-resolved node_id is dropped outright.</summary>
    private static bool KeepSeededNode(JsonNode? item, Diagnostics notes)
    {
        if (item is JsonObject o && Json.Str(o["node_id"]) is { Length: > 0 }) return true;
        var id = (item as JsonObject) is { } obj ? Json.Str(obj["id"]) : null;
        notes.Drop("node", id, string.IsNullOrEmpty(id) ? "invalid_shape" : "unresolved_path");
        return false;
    }

    private static JsonObject DropUnseeded(JsonObject authored, Diagnostics notes)
    {
        if (authored["nodes"] is not JsonArray nodes) return authored;
        var copy = (JsonObject)authored.DeepClone();
        copy["nodes"] = new JsonArray(nodes.Where(n => KeepSeededNode(n, notes)).Select(n => n?.DeepClone()).ToArray());
        return copy;
    }

    private static JsonObject CoerceStatuses(JsonObject resolved)
    {
        var notes = new Diagnostics();
        var nodes = new JsonArray();
        foreach (var node in resolved["nodes"]!.AsArray().OfType<JsonObject>())
        {
            var copy = (JsonObject)node.DeepClone();
            var meta = copy["meta"] is JsonObject m ? m : new JsonObject();
            copy["meta"] = meta;
            if (meta["status"] is { } status && !(Json.Str(status) is { } s && PlanStatuses.Contains(s)))
            {
                notes.Drop("node", Json.Str(node["id"]), "status_coerced", status.ToString());
                meta["status"] = null;
            }
            nodes.Add(copy);
        }
        resolved["nodes"] = nodes;
        resolved["diagnostics"] = Diagnostics.Merge(resolved["diagnostics"], notes.AsPayload());
        return resolved;
    }

    /// <summary>The ImpactDiagram-shaped payload GET /repos/{id}/impact returns to the canvas.</summary>
    public static JsonObject Resolve(Workspace ws)
    {
        var authored = DiagramArtifacts.Load(ws, "impact");
        var source = ImpactContext.AuthoredSource(authored);
        var feature = ImpactContext.AuthoredFeature(authored);
        var seedNotes = new Diagnostics();
        var seeded = (JsonObject)authored.DeepClone();
        seeded["type"] = "impact";
        seeded = DropUnseeded(seeded, seedNotes);
        var resolved = CoerceStatuses(DiagramResolver.Resolve(ws.Engine, seeded));
        resolved["diagnostics"] = Diagnostics.Merge(resolved["diagnostics"], seedNotes.AsPayload());
        resolved["has_diagram"] = authored.Count > 0;
        resolved["source"] = source;
        resolved["feature"] = feature;
        resolved["node_count"] = resolved["nodes"]!.AsArray().Count;
        resolved["truncated"] = false;

        var reviewed = Json.Str(authored["fingerprint"]);
        // No fingerprint to compare: skip re-deriving the slice on the common no-diagram read.
        if (string.IsNullOrEmpty(reviewed))
        {
            resolved["seed_count"] = 0;
            resolved["fingerprint"] = "";
            resolved["reviewed_fingerprint"] = reviewed;
            resolved["stale"] = false;
            return resolved;
        }
        var seeds = source == "plan" ? ImpactContext.FeatureSpecSeeds(ws, feature) : null;
        var current = ImpactContext.Fingerprint(ws, source, feature, seeds);
        resolved["seed_count"] = ImpactContext.SeedCount(ws, source, feature, seeds);
        resolved["fingerprint"] = current;
        resolved["reviewed_fingerprint"] = reviewed;
        resolved["stale"] = reviewed != current;
        return resolved;
    }
}
