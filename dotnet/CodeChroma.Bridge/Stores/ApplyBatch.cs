using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Stores;

public sealed record OpError(int OpIndex, string Code, string Message)
{
    public JsonObject ToJson() => new() { ["op_index"] = OpIndex, ["code"] = Code, ["message"] = Message };
}

/// <summary>`Doc`, `IdMap` and `Affected` are only meaningful when `Ok` is true.</summary>
public sealed class BatchResult
{
    public bool Ok { get; init; }
    public CanvasDoc? Doc { get; init; }
    public InsertionMap<string> IdMap { get; init; } = new();
    public List<string> Affected { get; init; } = [];
    public List<OpError> Errors { get; init; } = [];

    public static BatchResult Rejected(params OpError[] errors) => new() { Ok = false, Errors = [.. errors] };
}

/// <summary>The one write point onto a CanvasDoc: validates a whole batch before committing any of it.</summary>
public static class ApplyBatch
{
    public const int MaxOpsPerBatch = 100;
    public const int MaxExplanationChars = 1000;

    /// <summary>A batch deleting more elements/edges than this needs the caller's explicit confirmation.</summary>
    public const int MassDeleteGuard = 20;

    private static readonly HashSet<string> AddElementOps = ["add_element", "add_group", "add_note"];
    private static readonly HashSet<string> DeleteOps = ["delete_element", "delete_edge"];

    /// <summary>Neither kind's own web component (NoteElement.tsx/GroupFrame.tsx) ever reads node_id.</summary>
    private static readonly HashSet<string> NoNodeIdRenderKinds = ["note", "group"];

    /// <summary>Must match web/src/canvas/authoredStyle.ts's STYLE_ALLOWLIST.</summary>
    private static readonly HashSet<string> StyleAllowedKeys = ["color", "background", "border-color", "border-style"];

    private sealed class OpFailure(string code, string message) : Exception(message)
    {
        public string Code { get; } = code;
    }

    private sealed class Run
    {
        public required CanvasDoc Doc { get; init; }
        public required string Layer { get; init; }
        public InsertionMap<string> IdMap { get; } = new();
        public List<string> Affected { get; } = [];
        public List<string> Deleted { get; } = [];
    }

    /// <summary>Validates every op against a copy of `doc`; commits (never mutating `doc`) if all pass.</summary>
    public static BatchResult Apply(CanvasDoc doc, IReadOnlyList<JsonNode?> ops, string layer = "default", string explanation = "", bool confirmMassDelete = false)
    {
        if (explanation.Length > MaxExplanationChars)
            return BatchResult.Rejected(new OpError(-1, "explanation_too_long", $"explanation is {explanation.Length} chars, max is {MaxExplanationChars}"));
        if (ops.Count > MaxOpsPerBatch)
            return BatchResult.Rejected(new OpError(-1, "too_many_ops", $"batch has {ops.Count} ops, max is {MaxOpsPerBatch}"));
        if (ops.Any(op => op is not JsonObject))
        {
            return BatchResult.Rejected(ops.Select((op, index) => (op, index))
                .Where(pair => pair.op is not JsonObject)
                .Select(pair => new OpError(pair.index, "invalid_op", "op must be an object")).ToArray());
        }

        var run = new Run { Doc = doc.Clone(), Layer = layer };
        var errors = new List<OpError>();
        for (var index = 0; index < ops.Count; index++)
        {
            var op = (JsonObject)ops[index]!;
            var kind = Json.Str(op["op"]);
            if (kind is null || !Handlers.Contains(kind))
            {
                errors.Add(new OpError(index, "unknown_op", $"unknown op {Repr(op["op"])}"));
                continue;
            }
            try
            {
                Dispatch(kind, run, op);
            }
            catch (OpFailure failure)
            {
                errors.Add(new OpError(index, failure.Code, failure.Message));
            }
        }

        if (errors.Count == 0 && !confirmMassDelete && run.Deleted.Count > MassDeleteGuard)
        {
            errors.Add(new OpError(-1, "mass_delete_guard",
                $"batch deletes {run.Deleted.Count} item(s) once cascades are counted, max is {MassDeleteGuard} unconfirmed"));
        }
        if (errors.Count > 0) return new BatchResult { Ok = false, Errors = errors };
        return new BatchResult { Ok = true, Doc = run.Doc, IdMap = run.IdMap, Affected = Sorted(run.Affected) };
    }

    /// <summary>Runs `ops` as one logical batch, split into `chunkSize`-sized `Apply` calls.</summary>
    public static BatchResult ApplyChunked(CanvasDoc doc, IReadOnlyList<JsonNode?> ops, string layer = "default", string explanation = "", bool confirmMassDelete = false, int chunkSize = MaxOpsPerBatch)
    {
        if (ops.Count <= chunkSize) return Apply(doc, ops, layer, explanation, confirmMassDelete);
        // Counted over the whole set -- a per-chunk count could split a mass delete and dodge the guard.
        var deleteCount = ops.Count(op => op is JsonObject o && Json.Str(o["op"]) is { } name && DeleteOps.Contains(name));
        if (!confirmMassDelete && deleteCount > MassDeleteGuard)
            return BatchResult.Rejected(new OpError(-1, "mass_delete_guard", $"batch deletes {deleteCount} item(s), max is {MassDeleteGuard} unconfirmed"));
        var working = doc;
        var idMap = new InsertionMap<string>();
        var affected = new List<string>();
        for (var start = 0; start < ops.Count; start += chunkSize)
        {
            var chunk = ops.Skip(start).Take(chunkSize).Select(op => RewriteRefs(op, idMap)).ToList();
            // Already decided above, so a chunk's own smaller delete count can't re-trip the guard.
            var result = Apply(working, chunk, layer, explanation, confirmMassDelete: true);
            // Not atomic across chunks: `doc` itself stays untouched, but earlier chunks are lost.
            if (!result.Ok) return result;
            working = result.Doc!;
            foreach (var (temp, real) in result.IdMap) idMap[temp] = real;
            affected.AddRange(result.Affected);
        }
        return new BatchResult { Ok = true, Doc = working, IdMap = idMap, Affected = Sorted(affected) };
    }

    /// <summary>Swaps a group_id/from/to for the real id an earlier chunk's Apply minted.</summary>
    private static JsonNode? RewriteRefs(JsonNode? op, InsertionMap<string> idMap)
    {
        if (op is not JsonObject o) return op;
        JsonObject? rewritten = null;
        foreach (var field in new[] { "group_id", "from", "to" })
        {
            if (Json.Str(o[field]) is { } value && idMap.TryGetValue(value, out var real))
            {
                rewritten ??= (JsonObject)o.DeepClone();
                rewritten[field] = real;
            }
        }
        return rewritten ?? op;
    }

    private static List<string> Sorted(IEnumerable<string> ids) => ids.Distinct().Order(StringComparer.Ordinal).ToList();

    private static readonly HashSet<string> Handlers =
        ["add_element", "add_group", "add_note", "add_edge", "update_element", "update_edge", "delete_element", "delete_edge"];

    private static void Dispatch(string kind, Run run, JsonObject op)
    {
        switch (kind)
        {
            case "add_element" or "add_group" or "add_note": AddElement(run, op, kind); break;
            case "add_edge": AddEdge(run, op); break;
            case "update_element": UpdateElement(run, op); break;
            case "update_edge": UpdateEdge(run, op); break;
            case "delete_element": DeleteElement(run, op); break;
            default: DeleteEdge(run, op); break;
        }
    }

    private static string Repr(JsonNode? node) => node switch
    {
        null => "None",
        JsonValue v when v.TryGetValue(out string? s) => $"'{s}'",
        _ => node.ToJsonString(),
    };

    /// <summary>A temp_id from earlier in this batch, or a real id already present.</summary>
    private static string ResolveRef(Run run, JsonNode? refNode, bool element)
    {
        if (refNode is null) throw new OpFailure("missing_field", "a required id/ref field is missing");
        var text = Json.Str(refNode);
        var real = text is not null && run.IdMap.TryGetValue(text, out var mapped) ? mapped : text;
        var known = real is not null && (element ? run.Doc.Elements.ContainsKey(real) : run.Doc.Edges.ContainsKey(real));
        if (!known) throw new OpFailure("unknown_target", $"no {(element ? "element" : "edge")} {Repr(refNode)} in this batch or document");
        return real!;
    }

    /// <summary>Real edge id, or null once this batch already removed it (a cascade, or a repeat op).</summary>
    private static string? ResolveEdgeUnlessCascaded(Run run, JsonNode? refNode)
    {
        if (refNode is null) throw new OpFailure("missing_field", "a required id/ref field is missing");
        var text = Json.Str(refNode);
        if (text is not null && run.Deleted.Contains(run.IdMap.TryGetValue(text, out var mapped) ? mapped : text)) return null;
        return ResolveRef(run, refNode, element: false);
    }

    private static JsonObject? SanitizeStyle(JsonNode? value)
    {
        if (value is not JsonObject { Count: > 0 } style) return null;
        var filtered = new JsonObject();
        foreach (var (key, val) in style)
            if (StyleAllowedKeys.Contains(key)) filtered[key] = val?.DeepClone();
        return filtered.Count > 0 ? filtered : null;
    }

    /// <summary>A string-or-null field read the way pydantic reads `str | None`: absent is the default, wrong type is invalid.</summary>
    private static string? OptionalString(JsonObject op, string key, string? fallback, string what)
    {
        if (!op.ContainsKey(key)) return fallback;
        if (op[key] is null) return null;
        return Json.Str(op[key]) ?? throw new OpFailure("invalid_field", $"{what}: {key} must be a string");
    }

    private static string RequiredString(JsonObject op, string key, string fallback, string what) =>
        OptionalString(op, key, fallback, what) ?? throw new OpFailure("invalid_field", $"{what}: {key} must be a string");

    private static CanvasPosition ParsePosition(JsonNode? value)
    {
        if (value is not JsonObject o) throw new OpFailure("invalid_field", "position: must be an object");
        return new CanvasPosition { X = Number(o["x"], "position.x"), Y = Number(o["y"], "position.y") };
    }

    private static CanvasSize ParseSize(JsonNode? value)
    {
        if (value is not JsonObject o) throw new OpFailure("invalid_field", "size: must be an object");
        return new CanvasSize { W = Number(o["w"], "size.w"), H = Number(o["h"], "size.h") };
    }

    private static double Number(JsonNode? node, string what)
    {
        if (node is null) return 0.0;
        if (node is JsonValue v && v.TryGetValue(out double d)) return d;
        throw new OpFailure("invalid_field", $"{what}: must be a number");
    }

    private static JsonObject ValidStyle(JsonNode? raw)
    {
        var style = SanitizeStyle(raw);
        if (style is not null && style.Any(kv => Json.Str(kv.Value) is null))
            throw new OpFailure("invalid_field", "style: values must be strings");
        return style!;
    }

    private static void AddElement(Run run, JsonObject op, string kind)
    {
        var fallback = kind switch { "add_group" => "group", "add_note" => "note", _ => null };
        var renderNode = op.ContainsKey("render") ? op["render"] : fallback is null ? null : JsonValue.Create(fallback);
        if (!Json.Truthy(renderNode)) throw new OpFailure("missing_field", "add_element requires a 'render' kind");
        var render = Json.Str(renderNode);
        if (render is null || !CanvasDoc.RenderKinds.Contains(render)) throw new OpFailure("invalid_field", $"unknown render kind {Repr(renderNode)}");
        if (op["node_id"] is not null && NoNodeIdRenderKinds.Contains(render))
        {
            throw new OpFailure("invalid_field",
                $"render '{render}' elements never carry a node_id (see NoteElement.tsx/GroupFrame.tsx) -- use render='custom' for a code-linked box");
        }
        var position = Json.Truthy(op["position"]) ? op["position"] : new JsonObject();
        var size = op["size"];
        var meta = Json.Truthy(op["meta"]) ? op["meta"] : new JsonObject();
        if (meta is not JsonObject metaObject) throw new OpFailure("invalid_field", "meta must be an object");
        string? groupId = null;
        if (op["group_id"] is { } group) groupId = ResolveRef(run, group, element: true);

        var element = new CanvasElement
        {
            Render = render,
            Layer = RequiredString(op, "layer", run.Layer, "layer"),
            Label = OptionalString(op, "label", "", "label"),
            Description = OptionalString(op, "description", "", "description"),
            NodeId = OptionalString(op, "node_id", null, "node_id"),
            Position = ParsePosition(position),
            Size = Json.Truthy(size) ? ParseSize(size) : null,
            GroupId = groupId,
            Meta = (JsonObject)metaObject.DeepClone(),
            CreatedBy = RequiredString(op, "created_by", "ai", "created_by"),
            Style = ValidStyle(op["style"]),
        };
        run.Doc.Elements[element.Id] = element;
        MapTemp(run, op, element.Id);
        run.Affected.Add(element.Id);
    }

    private static void MapTemp(Run run, JsonObject op, string id)
    {
        if (op["temp_id"] is { } temp) run.IdMap[Json.Str(temp) ?? temp.ToJsonString()] = id;
    }

    private static void AddEdge(Run run, JsonObject op)
    {
        var from = ResolveRef(run, op["from"], element: true);
        var to = ResolveRef(run, op["to"], element: true);
        var edge = new CanvasEdge
        {
            From = from,
            To = to,
            Label = OptionalString(op, "label", "", "label"),
            Kind = OptionalString(op, "kind", "uses", "kind"),
            Layer = RequiredString(op, "layer", run.Layer, "layer"),
            Style = ValidStyle(op["style"]),
            Hero = Json.Truthy(op["hero"]),
            Transport = OptionalString(op, "transport", null, "transport"),
            Origin = OptionalString(op, "origin", null, "origin"),
        };
        run.Doc.Edges[edge.Id] = edge;
        MapTemp(run, op, edge.Id);
        run.Affected.Add(edge.Id);
    }

    private static void UpdateElement(Run run, JsonObject op)
    {
        var id = ResolveRef(run, op["id"], element: true);
        var element = run.Doc.Elements[id];
        if (op["node_id"] is not null && NoNodeIdRenderKinds.Contains(element.Render))
        {
            throw new OpFailure("invalid_field",
                $"render '{element.Render}' elements never carry a node_id (see NoteElement.tsx/GroupFrame.tsx) -- use render='custom' for a code-linked box");
        }
        if (op["position"] is not null) element.Position = ParsePosition(op["position"]);
        if (op.ContainsKey("size")) element.Size = Json.Truthy(op["size"]) ? ParseSize(op["size"]) : null;
        string? resolvedGroup = null;
        var groupPresent = op.ContainsKey("group_id");
        if (groupPresent && op["group_id"] is not null) resolvedGroup = ResolveRef(run, op["group_id"], element: true);
        if (op["meta"] is not null)
        {
            if (op["meta"] is not JsonObject meta) throw new OpFailure("invalid_field", "meta must be an object");
            // Merged, not replaced -- an unrelated update must never wipe meta.recipe_key.
            foreach (var (key, value) in meta) element.Meta[key] = value?.DeepClone();
        }
        // Replaced, not merged -- unlike meta, `style: null` is how a caller clears a highlight.
        if (op.ContainsKey("style")) element.Style = SanitizeStyle(op["style"]);
        if (op.ContainsKey("label")) element.Label = PatchString(op, "label");
        if (op.ContainsKey("description")) element.Description = PatchString(op, "description");
        if (op.ContainsKey("node_id")) element.NodeId = PatchString(op, "node_id");
        if (groupPresent) element.GroupId = op["group_id"] is null ? null : resolvedGroup;
        if (op.ContainsKey("layer")) element.Layer = PatchString(op, "layer") ?? element.Layer;
        run.Affected.Add(id);
    }

    private static string? PatchString(JsonObject op, string key) =>
        op[key] is null ? null : Json.Str(op[key]) ?? throw new OpFailure("invalid_field", $"{key} must be a string");

    private static void UpdateEdge(Run run, JsonObject op)
    {
        var id = ResolveEdgeUnlessCascaded(run, op["id"]);
        if (id is null) return;
        var edge = run.Doc.Edges[id];
        if (op.ContainsKey("from")) edge.From = ResolveRef(run, op["from"], element: true);
        if (op.ContainsKey("to")) edge.To = ResolveRef(run, op["to"], element: true);
        // Replaced, not merged -- `style: null` is how a caller clears an edge's own override.
        if (op.ContainsKey("style")) edge.Style = SanitizeStyle(op["style"]);
        if (op.ContainsKey("label")) edge.Label = PatchString(op, "label");
        if (op.ContainsKey("kind")) edge.Kind = PatchString(op, "kind");
        if (op.ContainsKey("layer")) edge.Layer = PatchString(op, "layer") ?? edge.Layer;
        if (op.ContainsKey("hero")) edge.Hero = Json.Truthy(op["hero"]);
        if (op.ContainsKey("transport")) edge.Transport = PatchString(op, "transport");
        if (op.ContainsKey("origin")) edge.Origin = PatchString(op, "origin");
        run.Affected.Add(id);
    }

    private static void DeleteElement(Run run, JsonObject op)
    {
        var id = ResolveRef(run, op["id"], element: true);
        run.Doc.Elements.Remove(id);
        run.Affected.Add(id);
        run.Deleted.Add(id);
        // Cascade: an edge pointing at a deleted element would otherwise dangle.
        foreach (var edgeId in run.Doc.Edges.Where(kv => kv.Value.From == id || kv.Value.To == id).Select(kv => kv.Key).ToList())
        {
            run.Doc.Edges.Remove(edgeId);
            run.Affected.Add(edgeId);
            run.Deleted.Add(edgeId);
        }
        // Cascade: any element grouped under the deleted one would otherwise point at nothing.
        foreach (var orphan in run.Doc.Elements.Values.Where(e => e.GroupId == id))
        {
            orphan.GroupId = null;
            run.Affected.Add(orphan.Id);
        }
    }

    private static void DeleteEdge(Run run, JsonObject op)
    {
        var id = ResolveEdgeUnlessCascaded(run, op["id"]);
        if (id is null) return;
        run.Doc.Edges.Remove(id);
        run.Affected.Add(id);
        run.Deleted.Add(id);
    }
}
