using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Engine;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Diagrams;

/// <summary>What a diagram write lost on its way to the canvas, in one shape every kind reuses.</summary>
public sealed class Diagnostics
{
    public const int MaxReported = 20;

    private readonly List<JsonObject> _items = [];

    public int Count => _items.Count;

    public void Drop(string what, string? id, string reason, string detail = "") =>
        _items.Add(new JsonObject { ["what"] = what, ["id"] = id, ["reason"] = reason, ["detail"] = detail });

    private static readonly string[] MessageKinds = ["call", "return", "ai", "event", "error"];
    private static readonly string[] EdgeKinds = ["calls", "spawns", "data", "reads", "writes", "minor"];
    private static readonly string[] EdgeKindAliases =
    [
        "call", "uses", "spawn", "process", "read", "write", "secondary", "imports", "implements",
        "extends", "inherits", "composes", "contains", "depends", "depends_on", "removed",
    ];
    private static readonly string[] PlainEdgeKinds = ["", "calls", "call", "uses"];
    private static readonly Regex FailureWords = new(@"\b(error|fail\w*|denied|timeout|timed out)\b", RegexOptions.IgnoreCase);
    private static readonly Regex SpawnWords = new(@"\b(spawn\w*|launch\w*|(start|starts|starting|run|runs|fork\w*)\s+(a\s+|an\s+|the\s+)?(sub)?(process|cli|agent|worker|daemon))\b", RegexOptions.IgnoreCase);
    private static readonly Regex DataWords = new(@"\b(read|reads|write|writes|reading|writing|persist\w*|stores?|saves?)\b.{0,40}\b(files?|disk|database|db|sqlite|store|cache|json)\b", RegexOptions.IgnoreCase);

    /// <summary>Records the check_diagram.py edge/message-kind advisories as soft diagnostics (never drops).</summary>
    public void AdviseRelations(IEnumerable<JsonNode?> relations, string? kind)
    {
        if (kind == "custom") return;
        foreach (var relation in relations.OfType<JsonObject>())
        {
            if (kind == "sequence") AdviseMessage(relation);
            else AdviseEdge(relation);
        }
    }

    private void AdviseMessage(JsonObject relation)
    {
        var kind = Json.Str(relation["kind"]);
        var id = Json.Str(relation["id"]);
        if (kind is not null && !MessageKinds.Contains(kind)) Drop("relation", id, "bad_message_kind", $"kind='{kind}'");
        var label = Json.Str(relation["label"]) ?? "";
        if (kind != "error" && !Json.Truthy(relation["failure"]) && FailureWords.IsMatch(label))
            Drop("relation", id, "failure_kind", $"label '{label}': set kind to error");
    }

    private void AdviseEdge(JsonObject relation)
    {
        var kindNode = relation["kind"];
        var kind = Json.Str(kindNode);
        var pair = $"{Json.Str(relation["from"])} -> {Json.Str(relation["to"])}";
        if (kind is not null && !EdgeKinds.Concat(EdgeKindAliases).Contains(kind.Trim().ToLowerInvariant()))
        {
            Drop("relation", pair, "bad_edge_kind", $"kind='{kind}'");
            return;
        }
        var plain = kindNode is null || (kind is not null && PlainEdgeKinds.Contains(kind.Trim().ToLowerInvariant()));
        if (!plain || Json.Str(relation["label"]) is not { } label) return;
        if (SpawnWords.IsMatch(label)) Drop("relation", pair, "edge_kind_spawn", $"label '{label}': set kind to spawns");
        else if (DataWords.IsMatch(label)) Drop("relation", pair, "edge_kind_data", $"label '{label}': set kind to data");
    }

    /// <summary>A capped list plus the true total the cap may have hidden.</summary>
    public JsonObject AsPayload()
    {
        var shown = _items.Take(MaxReported).Select(i => (JsonNode?)i.DeepClone()).ToArray();
        return new JsonObject { ["dropped"] = new JsonArray(shown), ["dropped_count"] = _items.Count, ["shown"] = shown.Length, ["truncated"] = _items.Count > shown.Length };
    }

    /// <summary>Whether one authored relation survives; endpoints must be known ids.</summary>
    public bool KeepRelation(JsonNode? item, HashSet<string> nodeIds, bool allowSelf)
    {
        if (item is not JsonObject o || Json.Str(o["from"]) is not { } from || Json.Str(o["to"]) is not { } to)
        {
            Drop("relation", null, "invalid_shape");
            return false;
        }
        var pair = $"{from} -> {to}";
        if (!nodeIds.Contains(from) || !nodeIds.Contains(to))
        {
            Drop("relation", pair, "dangling_endpoint");
            return false;
        }
        if (!allowSelf && from == to)
        {
            Drop("relation", pair, "self_relation");
            return false;
        }
        return true;
    }

    /// <summary>One diagnostics value from several stages (the resolver's and a recipe converter's).</summary>
    public static JsonObject Merge(params JsonNode?[] payloads)
    {
        var combined = new List<JsonNode?>();
        var total = 0;
        foreach (var payload in payloads.OfType<JsonObject>())
        {
            if (payload["dropped"] is JsonArray entries) combined.AddRange(entries.OfType<JsonObject>().Select(e => (JsonNode?)e.DeepClone()));
            total += payload["dropped_count"] is JsonValue v && v.TryGetValue(out int n) ? n : combined.Count;
        }
        var shown = combined.Take(MaxReported).ToArray();
        var count = Math.Max(total, combined.Count);
        return new JsonObject { ["dropped"] = new JsonArray(shown), ["dropped_count"] = count, ["shown"] = shown.Length, ["truncated"] = count > shown.Length };
    }
}

/// <summary>The render-style catalog's overrides, from the embedded llm_catalog.json (dumped from Python).</summary>
public static class DiagramStyles
{
    public static JsonObject? Catalog(string id) =>
        LlmCatalog.Data["diagram_styles"]!.AsArray().OfType<JsonObject>().FirstOrDefault(s => Json.Str(s["id"]) == id);

    /// <summary>A diagram's effective overrides: catalog name to overrides, an inline object as-is, else empty.</summary>
    public static JsonObject Overrides(JsonNode? source) => source switch
    {
        JsonObject o => (JsonObject)o.DeepClone(),
        JsonValue v when v.TryGetValue(out string? name) && Catalog(name) is { } style && style["overrides"] is JsonObject ov => (JsonObject)ov.DeepClone(),
        _ => new JsonObject(),
    };
}

/// <summary>Node and relation validation, path resolution and style order shared by every diagram type.</summary>
public static class DiagramResolver
{
    public static string? CleanPath(JsonNode? path)
    {
        if (Json.Str(path) is not { } text) return null;
        var cleaned = text.Trim();
        if (cleaned.StartsWith("./", StringComparison.Ordinal)) cleaned = cleaned[2..];
        cleaned = cleaned.Trim().Trim('/');
        return cleaned.Length == 0 ? null : cleaned;
    }

    /// <summary>Exact match only: a stale path stays unresolved rather than falling back to an ancestor.</summary>
    public static string? ResolvePathNode(IGraphEngine engine, JsonNode? path)
    {
        if (CleanPath(path) is not { } clean) return null;
        foreach (var candidate in new[] { $"component::{clean}", $"dir::{clean}" })
            if (engine.GetNode(candidate) is not null) return candidate;
        return null;
    }

    private static JsonObject Stamp(JsonObject node, string? path)
    {
        var meta = node["meta"] as JsonObject;
        string reason;
        string? detail = null;
        if (meta is not null && Json.Str(meta["plan_kind"]) is "add" or "create") reason = "planned";
        else if (!string.IsNullOrEmpty(path)) { reason = "unresolved"; detail = path; }
        else if (meta is not null && meta["external"] is JsonValue v && v.TryGetValue(out bool external) && external) reason = "external";
        else reason = "conceptual";
        var merged = meta is null ? new JsonObject() : (JsonObject)meta.DeepClone();
        merged["no_code_reason"] = reason;
        if (detail is not null) merged["no_code_detail"] = detail;
        node["meta"] = merged;
        return node;
    }

    private static JsonObject ResolveNode(IGraphEngine engine, JsonObject item, Diagnostics notes)
    {
        var copy = (JsonObject)item.DeepClone();
        if (Json.Str(item["node_id"]) is { Length: > 0 }) return copy;
        var path = Json.Str(item["path"]);
        if (string.IsNullOrEmpty(path)) return Stamp(copy, null);
        var nodeId = ResolvePathNode(engine, path);
        if (nodeId is null)
        {
            notes.Drop("node", Json.Str(item["id"]), "unresolved_path", path);
            copy["node_id"] = null;
            return Stamp(copy, path);
        }
        copy["node_id"] = nodeId;
        return copy;
    }

    /// <summary>The one resolver every diagram kind calls; a style source of null falls back to the diagram's own.</summary>
    public static JsonObject Resolve(IGraphEngine engine, JsonObject data, JsonNode? styleSource = null, string? kind = null)
    {
        var notes = new Diagnostics();
        var overrides = DiagramStyles.Overrides(styleSource ?? data["style"]);
        var allowSelf = Json.Truthy(overrides["allow_self_relations"]);
        var edgeStyle = overrides["edge_style"] as JsonObject ?? [];

        var seen = new HashSet<string>();
        var nodes = new List<JsonObject>();
        foreach (var item in data["nodes"] as JsonArray ?? [])
        {
            if (item is not JsonObject o || Json.Str(o["id"]) is not { Length: > 0 } id)
            {
                notes.Drop("node", (item as JsonObject) is { } bad ? Json.Str(bad["id"]) : null, "invalid_shape");
                continue;
            }
            if (!seen.Add(id)) { notes.Drop("node", id, "duplicate_sibling_id"); continue; }
            nodes.Add(ResolveNode(engine, o, notes));
        }
        foreach (var node in nodes)
        {
            if (node["parent"] is null) continue;
            if (Json.Str(node["parent"]) is { } parent && seen.Contains(parent)) continue;
            notes.Drop("node", Json.Str(node["id"]), "dangling_endpoint", node["parent"]!.ToString());
            node["parent"] = null;
        }

        var relations = new List<JsonNode?>();
        foreach (var item in data["relations"] as JsonArray ?? [])
        {
            if (!notes.KeepRelation(item, seen, allowSelf)) continue;
            var relation = (JsonObject)item!.DeepClone();
            relation["style"] = relation["style"] is JsonObject own ? own.DeepClone() : edgeStyle.Count > 0 ? edgeStyle.DeepClone() : null;
            relations.Add(relation);
        }

        notes.AdviseRelations(relations, kind ?? Json.Str(data["type"]));

        var groups = new JsonArray();
        if (Json.Truthy(overrides["supports_groups"]))
            foreach (var group in nodes.Select(n => Json.Str(n["group"])).Where(g => !string.IsNullOrEmpty(g)).Distinct().Order(StringComparer.Ordinal))
                groups.Add(group);

        var resolved = (JsonObject)data.DeepClone();
        resolved["nodes"] = new JsonArray(nodes.Select(n => (JsonNode?)n).ToArray());
        resolved["relations"] = new JsonArray(relations.ToArray());
        resolved["groups"] = groups;
        resolved["diagnostics"] = notes.AsPayload();
        return AttachOrigins(engine, resolved);
    }

    /// <summary>Stamps meta.origin (file:line) on each relation whose source endpoint maps to a node with a symbol.</summary>
    public static JsonObject AttachOrigins(IGraphEngine engine, JsonObject resolved)
    {
        var byAuthorId = new Dictionary<string, string>();
        foreach (var node in resolved["nodes"] as JsonArray ?? [])
            if (node is JsonObject o && Json.Str(o["id"]) is { } id && Json.Str(o["node_id"]) is { } nodeId) byAuthorId[id] = nodeId;
        if (byAuthorId.Count == 0) return resolved;
        foreach (var relation in resolved["relations"] as JsonArray ?? [])
        {
            if (relation is not JsonObject r || Json.Str(r["from"]) is not { } from || Json.Str(r["to"]) is null) continue;
            if (!byAuthorId.TryGetValue(from, out var nodeId) || engine.GetSymbol(nodeId) is not { } symbol) continue;
            var meta = r["meta"] is JsonObject m ? (JsonObject)m.DeepClone() : new JsonObject();
            meta["origin"] = $"{symbol.FilePath}:{symbol.StartLine}";
            r["meta"] = meta;
        }
        return resolved;
    }

    /// <summary>Every repo path a flat nodes[] diagram claims, i.e. what counts as covered code.</summary>
    public static HashSet<string> AuthoredPaths(JsonObject data) =>
        [.. (data["nodes"] as JsonArray ?? []).OfType<JsonObject>().Select(n => CleanPath(n["path"])).OfType<string>()];

    public static JsonObject AttachCoverage(JsonObject resolved, IGraphEngine engine)
    {
        resolved["unmapped"] = new JsonArray(Coverage.UncoveredRoots(engine, AuthoredPaths(resolved)).Entries.Select(e => (JsonNode?)e).ToArray());
        return resolved;
    }

    public static JsonObject AttachStaleness(JsonObject resolved, string fingerprint, string? reviewedFingerprint)
    {
        resolved["fingerprint"] = fingerprint;
        resolved["reviewed_fingerprint"] = reviewedFingerprint;
        resolved["stale"] = !string.IsNullOrEmpty(reviewedFingerprint) && reviewedFingerprint != fingerprint;
        return resolved;
    }
}
