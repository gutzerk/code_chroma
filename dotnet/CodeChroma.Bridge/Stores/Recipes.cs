using CodeChroma.Bridge.Diagrams;
using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Stores;

/// <summary>One canvas element a recipe wants, keyed by a stable id from its own source data.</summary>
public sealed record RecipeNode(
    string Key, string Render, string Label, string Description = "", string? NodeId = null, string? Group = null,
    JsonObject? Meta = null, JsonObject? Style = null, JsonObject? Size = null);

/// <summary>One canvas edge a recipe wants, referencing two <see cref="RecipeNode"/> keys from the same result.</summary>
public sealed record RecipeEdge(
    string FromKey, string ToKey, string Label = "", string Kind = "uses", JsonObject? Style = null, bool Hero = false,
    string? Transport = null, string? Origin = null);

public sealed record RecipeResult(IReadOnlyList<RecipeNode> Nodes, IReadOnlyList<RecipeEdge> Edges, IReadOnlyList<JsonObject> Dropped);

/// <summary>The canonical per-diagram shape <see cref="Recipes.Reshape"/> produces: flat nodes plus raw relations.</summary>
public sealed record GraphShape(IReadOnlyList<RecipeNode> Nodes, IReadOnlyList<JsonNode?> Relations);

/// <summary>One recipe's own layer name plus which `render` kind its nodes get.</summary>
public sealed record Recipe(string Name, string Layer, string Render)
{
    public RecipeResult ToOps(JsonObject resolved) => Recipes.GraphToOps(Recipes.Reshape(resolved, Render));
}

/// <summary>What a diagram write lost on its way to the canvas, in the one shape every diagram kind reuses.</summary>
public sealed class DroppedLog
{
    /// <summary>`settings.diagram_diagnostics.max_reported`.</summary>
    public const int MaxReported = 20;

    private readonly List<JsonObject> _items = [];

    public IReadOnlyList<JsonObject> Items => _items;

    /// <summary>Records one loss; a non-string id becomes null so the payload stays JSON-safe.</summary>
    public void Drop(string what, string? id, string reason, string detail = "") =>
        _items.Add(new JsonObject { ["what"] = what, ["id"] = id, ["reason"] = reason, ["detail"] = detail });

    /// <summary>Caps an already-serialized drop list, reporting how many entries the cap omitted.</summary>
    public static JsonObject BuildPayload(IReadOnlyList<JsonObject> dropped)
    {
        var shown = dropped.Take(MaxReported).Select(item => (JsonNode?)item.DeepClone()).ToArray();
        return new JsonObject
        {
            ["dropped"] = new JsonArray(shown),
            ["dropped_count"] = dropped.Count,
            ["shown"] = shown.Length,
            ["truncated"] = dropped.Count > shown.Length,
        };
    }

    /// <summary>One `diagnostics` value from several stages -- the resolver's and the recipe converter's.</summary>
    public static JsonObject Merge(params JsonNode?[] payloads)
    {
        // Totals come from each payload's own dropped_count: an already-capped input would undercount.
        var combined = new List<JsonObject>();
        var total = 0;
        foreach (var payload in payloads)
        {
            if (payload is not JsonObject o) continue;
            if (o["dropped"] is JsonArray entries) combined.AddRange(entries.OfType<JsonObject>().Select(e => (JsonObject)e.DeepClone()));
            total += o["dropped_count"] is JsonValue v && v.TryGetValue(out int reported) ? reported : combined.Count;
        }
        var merged = BuildPayload(combined);
        var count = Math.Max(total, merged["dropped_count"]!.GetValue<int>());
        merged["dropped_count"] = count;
        merged["truncated"] = count > merged["shown"]!.GetValue<int>();
        return merged;
    }
}

/// <summary>Converts a diagram kind's resolved payload into canvas ops, reconciling against the document's existing ones.</summary>
public static class Recipes
{
    public const string RecipeKey = "recipe_key";

    private static readonly Dictionary<string, string> RenderByKind = new()
    {
        ["c1"] = "c1", ["patterns"] = "pattern", ["impact"] = "impact", ["epics"] = "epic", ["sequence"] = "sequence",
    };

    /// <summary>A lazily synthesized "&lt;prefix&gt;/&lt;id&gt;" kind.</summary>
    private static readonly string[] SynthesizedPrefixes = ["custom/", "feature-plan/", "epics/"];

    /// <summary>The `render` string a diagram kind's canvas elements carry -- a fixed naming convention.</summary>
    public static string RenderFor(string kind)
    {
        if (kind.StartsWith("custom/", StringComparison.Ordinal)) return "custom";
        if (kind.StartsWith("epics/", StringComparison.Ordinal)) return "epic";
        return RenderByKind.GetValueOrDefault(kind, "custom");
    }

    /// <summary>The recipe `name` names (every synthesized "&lt;prefix&gt;/&lt;id&gt;" kind shares one shape), or null.</summary>
    public static Recipe? RecipeFor(string name)
    {
        if (RenderByKind.ContainsKey(name)) return new Recipe(name, name, RenderFor(name));
        foreach (var prefix in SynthesizedPrefixes)
            if (name.StartsWith(prefix, StringComparison.Ordinal) && name.Length > prefix.Length) return new Recipe(name, name, RenderFor(name));
        return null;
    }

    private static string PyStr(JsonNode? node) => node switch
    {
        null => "None",
        JsonValue v when v.TryGetValue(out string? s) => s,
        JsonValue v when v.TryGetValue(out bool b) => b ? "True" : "False",
        _ => node.ToJsonString(),
    };

    /// <summary>Python's `str(x or default)`.</summary>
    private static string TextOr(JsonNode? node, string fallback = "") => Json.Truthy(node) ? PyStr(node) : fallback;

    private static JsonObject? StyleOf(JsonNode? item) => item is JsonObject o && o["style"] is JsonObject style ? (JsonObject)style.DeepClone() : null;

    private static RecipeNode NodeOf(JsonObject item, string render)
    {
        var meta = item["meta"] is JsonObject own ? (JsonObject)own.DeepClone() : [];
        foreach (var key in new[] { "kind", "icon", "parent", "seed", "order", "lane", "path" })
            if (item[key] is { } value && (key is "kind" or "icon" or "parent" or "seed" || !meta.ContainsKey(key))) meta[key] = value.DeepClone();
        // A per-node `render` override lets one diagram mix kinds (an epics brief draws epic and spec boxes).
        var resolvedRender = Json.Str(item["render"]) ?? render;
        var label = Json.Truthy(item["name"]) ? PyStr(item["name"]) : Json.Truthy(item["title"]) ? PyStr(item["title"]) : PyStr(item["id"]);
        return new RecipeNode(
            Key: Json.Str(item["id"])!, Render: resolvedRender, Label: label, Description: TextOr(item["description"]),
            NodeId: Json.Str(item["node_id"]), Group: Json.Str(item["group"]), Meta: meta, Style: StyleOf(item),
            Size: item["size"] is JsonObject size ? (JsonObject)size.DeepClone() : null);
    }

    /// <summary>One shared shape: nodes come from "nodes", or "items" for the epics index.</summary>
    public static GraphShape Reshape(JsonObject resolved, string render)
    {
        var shape = ReshapeNodes(resolved, render);
        return RouteCarrier(resolved) is { } carrier ? shape with { Nodes = [.. shape.Nodes, carrier] } : shape;
    }

    private static GraphShape ReshapeNodes(JsonObject resolved, string render)
    {
        var rawNodes = resolved["nodes"] as JsonArray ?? (Json.Truthy(resolved["items"]) ? resolved["items"] as JsonArray : null) ?? [];
        var nodes = rawNodes.OfType<JsonObject>().Where(item => Json.Str(item["id"]) is not null).Select(item => NodeOf(item, render)).ToList();
        nodes = WithRoute(nodes, resolved);
        IReadOnlyList<JsonNode?> relations = resolved["relations"] is JsonArray array && array.Count > 0 ? array.ToList() : [];
        if (render != "sequence") return new GraphShape(nodes, relations);

        // A sequence diagram's messages are dedicated elements (not edges): relations become message-nodes
        // and participants get role "participant". A message naming no participant is dropped.
        var participantRefs = nodes.Select(node => node.Key).ToHashSet();
        var messages = relations.OfType<JsonObject>()
            .Where(item => Json.Str(item["id"]) is not null
                && Json.Str(item["from"]) is { } from && participantRefs.Contains(from)
                && Json.Str(item["to"]) is { } to && participantRefs.Contains(to));
        // 022: the diagram-level readability data rides on every participant's meta.
        var readability = new[] { "phases", "frames", "notes", "question", "summary" }
            .Where(key => Json.Truthy(resolved[key])).ToDictionary(key => key, key => resolved[key]!);
        var sequenceNodes = nodes.Select(node => ParticipantNode(node, readability)).Concat(messages.Select(MessageNode)).ToList();
        return new GraphShape(sequenceNodes, []);
    }

    public const string RouteRender = "route";
    public const string RouteKeyPrefix = "__route__::";

    /// <summary>The authored route, its id and its well-formed steps, or null when the diagram has none.</summary>
    private static (JsonObject Route, string Id, List<JsonObject> Steps)? RouteParts(JsonObject resolved)
    {
        if (resolved["route"] is not JsonObject route || route["steps"] is not JsonArray rawSteps) return null;
        var steps = rawSteps.OfType<JsonObject>().Where(step => Json.Str(step["id"]) is not null).ToList();
        var clean = (JsonObject)route.DeepClone();
        clean["steps"] = new JsonArray(steps.Select(step => step.DeepClone()).ToArray());
        if (!Json.Truthy(clean["summary"])) clean["summary"] = DiagramResolver.RouteSummary((JsonArray)clean["steps"]!); // a raw artifact has none
        return (clean, Json.Str(route["id"]) is { Length: > 0 } id ? id : "route", steps);
    }

    /// <summary>Stamps `route_id` on each node and `route_step` on a step's; the route itself rides once (026).</summary>
    private static List<RecipeNode> WithRoute(List<RecipeNode> nodes, JsonObject resolved)
    {
        if (RouteParts(resolved) is not { } parts) return nodes;
        var byId = parts.Steps.ToDictionary(step => Json.Str(step["id"])!);
        return nodes.Select(node =>
        {
            var meta = (JsonObject)(node.Meta ?? []).DeepClone();
            meta["route_id"] = parts.Id;
            if (byId.TryGetValue(node.Key, out var step)) meta["route_step"] = step.DeepClone();
            return node with { Meta = meta };
        }).ToList();
    }

    /// <summary>The one undrawn element that holds the diagram's whole route (026).</summary>
    private static RecipeNode? RouteCarrier(JsonObject resolved)
    {
        if (RouteParts(resolved) is not { } parts) return null;
        var meta = new JsonObject { ["route"] = parts.Route, ["route_id"] = parts.Id };
        var label = Json.Truthy(parts.Route["title"]) ? PyStr(parts.Route["title"]) : parts.Id;
        return new RecipeNode(Key: RouteKeyPrefix + parts.Id, Render: RouteRender, Label: label, Description: "", NodeId: null, Group: null, Meta: meta, Style: null, Size: null);
    }

    private static RecipeNode ParticipantNode(RecipeNode node, Dictionary<string, JsonNode> readability)
    {
        var meta = (JsonObject)(node.Meta ?? []).DeepClone();
        foreach (var (key, value) in readability) meta[key] = value.DeepClone();
        meta["role"] = "participant";
        return node with { Meta = meta };
    }

    private static RecipeNode MessageNode(JsonObject item)
    {
        var meta = item["meta"] is JsonObject own ? (JsonObject)own.DeepClone() : [];
        meta["role"] = "message";
        meta["from"] = item["from"]?.DeepClone();
        meta["to"] = item["to"]?.DeepClone();
        meta["order"] = item["order"]?.DeepClone();
        meta["async"] = Json.Truthy(item["async"]);
        meta["return"] = Json.Truthy(item["return"]);
        meta["hero"] = Json.Truthy(item["hero"]);
        if (Json.Str(item["kind"]) is { Length: > 0 } kind) meta["kind"] = kind;
        if (item["failure"] is not null) meta["failure"] = Json.Truthy(item["failure"]);
        return new RecipeNode(Key: Json.Str(item["id"])!, Render: "sequence", Label: TextOr(item["label"]), Description: TextOr(item["description"]), Meta: meta, Style: StyleOf(item));
    }

    private static string RelationPair(JsonObject relation) => $"{PyStr(relation["from"])} -> {PyStr(relation["to"])}";

    /// <summary>The one walk from a <see cref="GraphShape"/> to the flat nodes and edges it emits.</summary>
    public static RecipeResult GraphToOps(GraphShape shape)
    {
        var keys = shape.Nodes.Select(node => node.Key).ToHashSet();
        var edges = new List<RecipeEdge>();
        var notes = new DroppedLog();
        foreach (var relation in shape.Relations)
        {
            if (relation is not JsonObject r)
            {
                notes.Drop("relation", null, "invalid_shape");
                continue;
            }
            var fromKey = Json.Str(r["from"]);
            var toKey = Json.Str(r["to"]);
            if (fromKey is null || toKey is null || !keys.Contains(fromKey) || !keys.Contains(toKey))
            {
                notes.Drop("relation", RelationPair(r), "dangling_endpoint");
                continue;
            }
            var origin = r["meta"] is JsonObject meta ? meta["origin"] : null;
            edges.Add(new RecipeEdge(
                fromKey, toKey, TextOr(r["label"]), TextOr(r["kind"], "uses"), StyleOf(r), Json.Truthy(r["hero"]),
                Json.Truthy(r["transport"]) ? PyStr(r["transport"]) : null, Json.Truthy(origin) ? PyStr(origin) : null));
        }
        return new RecipeResult(shape.Nodes, edges, notes.Items);
    }

    private static string GroupKey(string group) => $"__group__::{group}";

    /// <summary>The ops that bring `layer` in line with `result`, touching only what it still owns.</summary>
    public static List<JsonNode?> BuildBatchOps(CanvasDoc doc, string layer, RecipeResult result)
    {
        var existingByKey = new InsertionMap<CanvasElement>();
        foreach (var element in doc.Elements.Values)
            if (element.Layer == layer && element.CreatedBy == "ai" && Json.Str(element.Meta[RecipeKey]) is { } key) existingByKey[key] = element;

        var ops = new List<JsonNode?>();
        var seenKeys = new HashSet<string>();
        var refFor = new Dictionary<string, string>();

        var groupRef = new Dictionary<string, string>();
        foreach (var group in result.Nodes.Select(node => node.Group).Where(g => !string.IsNullOrEmpty(g)).Distinct().Order(StringComparer.Ordinal))
        {
            var groupKey = GroupKey(group!);
            seenKeys.Add(groupKey);
            if (existingByKey.TryGetValue(groupKey, out var existing))
            {
                groupRef[group!] = existing.Id;
                if (existing.Label != group) ops.Add(new JsonObject { ["op"] = "update_element", ["id"] = existing.Id, ["label"] = group });
            }
            else
            {
                var temp = $"g{ops.Count}";
                groupRef[group!] = temp;
                ops.Add(new JsonObject
                {
                    ["op"] = "add_group", ["temp_id"] = temp, ["layer"] = layer, ["label"] = group,
                    ["meta"] = new JsonObject { [RecipeKey] = groupKey }, ["created_by"] = "ai",
                });
            }
        }

        foreach (var node in result.Nodes)
        {
            seenKeys.Add(node.Key);
            string? groupId = node.Group is { Length: > 0 } g ? groupRef.GetValueOrDefault(g) : null;
            var meta = (JsonObject)(node.Meta ?? []).DeepClone();
            meta[RecipeKey] = node.Key;
            JsonObject op;
            if (existingByKey.TryGetValue(node.Key, out var existing))
            {
                refFor[node.Key] = existing.Id;
                op = new JsonObject
                {
                    ["op"] = "update_element", ["id"] = existing.Id, ["label"] = node.Label, ["description"] = node.Description,
                    ["node_id"] = node.NodeId, ["group_id"] = groupId, ["meta"] = meta,
                };
            }
            else
            {
                var temp = $"n{ops.Count}";
                refFor[node.Key] = temp;
                op = new JsonObject
                {
                    ["op"] = "add_element", ["temp_id"] = temp, ["render"] = node.Render, ["layer"] = layer, ["label"] = node.Label,
                    ["description"] = node.Description, ["node_id"] = node.NodeId, ["group_id"] = groupId, ["meta"] = meta, ["created_by"] = "ai",
                };
            }
            // Never emit `style: null` or `size: null` -- an unrelated regenerate must not clear a manual override.
            if (node.Style is not null) op["style"] = node.Style.DeepClone();
            if (node.Size is not null) op["size"] = node.Size.DeepClone();
            ops.Add(op);
        }

        var deleting = new HashSet<string>();
        foreach (var (key, element) in existingByKey)
        {
            if (seenKeys.Contains(key)) continue;
            deleting.Add(element.Id);
            ops.Add(new JsonObject { ["op"] = "delete_element", ["id"] = element.Id });
        }

        var aiIds = existingByKey.Values.Select(e => e.Id).ToHashSet();
        var existingEdges = new Dictionary<(string, string), CanvasEdge>();
        var edgeOrder = new List<(string, string)>();
        foreach (var edge in doc.Edges.Values)
        {
            // delete_element's own cascade already drops an edge on a deleted element -- don't double-delete it.
            if (edge.Layer != layer || !aiIds.Contains(edge.From) || !aiIds.Contains(edge.To) || deleting.Contains(edge.From) || deleting.Contains(edge.To)) continue;
            var pair = (edge.From, edge.To);
            if (!existingEdges.ContainsKey(pair)) edgeOrder.Add(pair);
            existingEdges[pair] = edge;
        }
        var seenPairs = new HashSet<(string, string)>();
        foreach (var edge in result.Edges)
        {
            if (!refFor.TryGetValue(edge.FromKey, out var fromRef) || !refFor.TryGetValue(edge.ToKey, out var toRef)) continue;
            var pair = (fromRef, toRef);
            if (aiIds.Contains(pair.Item1) && existingEdges.TryGetValue(pair, out var existing))
            {
                seenPairs.Add(pair);
                // Only fields we will actually emit may flag a change, or an unchanged re-run would never converge.
                var changed = existing.Label != edge.Label || existing.Kind != edge.Kind || existing.Hero != edge.Hero
                    || (edge.Style is not null && existing.Style?.ToJsonString() != edge.Style.ToJsonString())
                    || (edge.Transport is not null && existing.Transport != edge.Transport)
                    || (edge.Origin is not null && existing.Origin != edge.Origin);
                if (!changed) continue;
                var op = new JsonObject { ["op"] = "update_edge", ["id"] = existing.Id, ["label"] = edge.Label, ["kind"] = edge.Kind, ["hero"] = edge.Hero };
                AddEdgeExtras(op, edge);
                ops.Add(op);
            }
            else
            {
                var op = new JsonObject
                {
                    ["op"] = "add_edge", ["from"] = fromRef, ["to"] = toRef, ["label"] = edge.Label, ["kind"] = edge.Kind, ["layer"] = layer, ["hero"] = edge.Hero,
                };
                AddEdgeExtras(op, edge);
                ops.Add(op);
            }
        }
        foreach (var pair in edgeOrder)
            if (!seenPairs.Contains(pair)) ops.Add(new JsonObject { ["op"] = "delete_edge", ["id"] = existingEdges[pair].Id });
        return ops;
    }

    private static void AddEdgeExtras(JsonObject op, RecipeEdge edge)
    {
        if (edge.Style is not null) op["style"] = edge.Style.DeepClone();
        if (edge.Transport is not null) op["transport"] = edge.Transport;
        if (edge.Origin is not null) op["origin"] = edge.Origin;
    }

    /// <summary>The ops one run of recipe `name` needs, plus what the converter itself could not draw.</summary>
    public static (List<JsonNode?> Ops, IReadOnlyList<JsonObject> Dropped) RunWithDrops(CanvasDoc doc, Recipe recipe, JsonObject resolved)
    {
        var result = recipe.ToOps(resolved);
        return (BuildBatchOps(doc, recipe.Layer, result), result.Dropped);
    }
}
