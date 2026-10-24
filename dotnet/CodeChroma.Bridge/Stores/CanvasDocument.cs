using System.Text.Json;
using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Stores;

/// <summary>Insertion-ordered string-keyed map, like a Python dict (output order is part of parity).</summary>
public sealed class InsertionMap<TValue> : IEnumerable<KeyValuePair<string, TValue>>
{
    private readonly Dictionary<string, TValue> _items = [];
    private readonly List<string> _order = [];

    public TValue this[string key]
    {
        get => _items[key];
        set
        {
            if (!_items.ContainsKey(key)) _order.Add(key);
            _items[key] = value;
        }
    }

    public int Count => _order.Count;

    public IEnumerable<string> Keys => _order;

    public IEnumerable<TValue> Values => _order.Select(key => _items[key]);

    public bool ContainsKey(string key) => _items.ContainsKey(key);

    public bool TryGetValue(string key, out TValue value) => _items.TryGetValue(key, out value!);

    public bool Remove(string key)
    {
        if (!_items.Remove(key)) return false;
        _order.Remove(key);
        return true;
    }

    public IEnumerator<KeyValuePair<string, TValue>> GetEnumerator() =>
        _order.Select(key => new KeyValuePair<string, TValue>(key, _items[key])).GetEnumerator();

    System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();
}

public sealed class CanvasPosition
{
    public double X { get; set; }
    public double Y { get; set; }

    public JsonObject ToJson() => new() { ["x"] = X, ["y"] = Y };

    public CanvasPosition Clone() => new() { X = X, Y = Y };

    public static CanvasPosition FromJson(JsonNode? node) =>
        node is JsonObject o ? new CanvasPosition { X = Num(o["x"]), Y = Num(o["y"]) } : new CanvasPosition();

    internal static double Num(JsonNode? node) =>
        node is JsonValue v && v.TryGetValue(out double d) ? d : 0.0;
}

public sealed class CanvasSize
{
    public double W { get; set; }
    public double H { get; set; }

    public JsonObject ToJson() => new() { ["w"] = W, ["h"] = H };

    public CanvasSize Clone() => new() { W = W, H = H };

    public static CanvasSize? FromJson(JsonNode? node) =>
        node is JsonObject o ? new CanvasSize { W = CanvasPosition.Num(o["w"]), H = CanvasPosition.Num(o["h"]) } : null;
}

/// <summary>One box on the canvas: a hierarchy pin, a recipe-authored node, a group or a note.</summary>
public sealed class CanvasElement
{
    public string Id { get; set; } = CanvasIds.New();
    public string Render { get; set; } = "note";
    public string Layer { get; set; } = "default";
    public string? Label { get; set; } = "";
    public string? Description { get; set; } = "";
    public string? NodeId { get; set; }
    public CanvasPosition Position { get; set; } = new();
    public CanvasSize? Size { get; set; }
    public string? GroupId { get; set; }
    public JsonObject Meta { get; set; } = [];
    public string CreatedBy { get; set; } = "ai";
    public JsonObject? Style { get; set; }

    public JsonObject ToJson() => new()
    {
        ["id"] = Id,
        ["render"] = Render,
        ["layer"] = Layer,
        ["label"] = Label,
        ["description"] = Description,
        ["node_id"] = NodeId,
        ["position"] = Position.ToJson(),
        ["size"] = Size?.ToJson(),
        ["group_id"] = GroupId,
        ["meta"] = Meta.DeepClone(),
        ["created_by"] = CreatedBy,
        ["style"] = Style?.DeepClone(),
    };

    public CanvasElement Clone() => new()
    {
        Id = Id, Render = Render, Layer = Layer, Label = Label, Description = Description, NodeId = NodeId,
        Position = Position.Clone(), Size = Size?.Clone(), GroupId = GroupId,
        Meta = (JsonObject)Meta.DeepClone(), CreatedBy = CreatedBy, Style = (JsonObject?)Style?.DeepClone(),
    };

    /// <summary>Lenient parse of one stored element: a wrong-typed field falls back to its default.</summary>
    public static CanvasElement FromJson(JsonObject o) => new()
    {
        Id = Json.Str(o["id"]) ?? CanvasIds.New(),
        Render = Json.Str(o["render"]) ?? "note",
        Layer = Json.Str(o["layer"]) ?? "default",
        Label = o.ContainsKey("label") ? Json.Str(o["label"]) : "",
        Description = o.ContainsKey("description") ? Json.Str(o["description"]) : "",
        NodeId = Json.Str(o["node_id"]),
        Position = CanvasPosition.FromJson(o["position"]),
        Size = CanvasSize.FromJson(o["size"]),
        GroupId = Json.Str(o["group_id"]),
        Meta = o["meta"] is JsonObject meta ? (JsonObject)meta.DeepClone() : [],
        CreatedBy = Json.Str(o["created_by"]) ?? "ai",
        Style = o["style"] is JsonObject style ? (JsonObject)style.DeepClone() : null,
    };
}

/// <summary>One arrow between two elements, referenced by id.</summary>
public sealed class CanvasEdge
{
    public string Id { get; set; } = CanvasIds.New();
    public string From { get; set; } = "";
    public string To { get; set; } = "";
    public string? Label { get; set; } = "";
    public string? Kind { get; set; } = "uses";
    public string Layer { get; set; } = "default";
    public JsonObject? Style { get; set; }
    public bool Hero { get; set; }
    public string? Transport { get; set; }
    public string? Origin { get; set; }

    public JsonObject ToJson() => new()
    {
        ["id"] = Id,
        ["from"] = From,
        ["to"] = To,
        ["label"] = Label,
        ["kind"] = Kind,
        ["layer"] = Layer,
        ["style"] = Style?.DeepClone(),
        ["hero"] = Hero,
        ["transport"] = Transport,
        ["origin"] = Origin,
    };

    public CanvasEdge Clone() => new()
    {
        Id = Id, From = From, To = To, Label = Label, Kind = Kind, Layer = Layer,
        Style = (JsonObject?)Style?.DeepClone(), Hero = Hero, Transport = Transport, Origin = Origin,
    };

    public static CanvasEdge FromJson(JsonObject o) => new()
    {
        Id = Json.Str(o["id"]) ?? CanvasIds.New(),
        From = Json.Str(o["from"]) ?? "",
        To = Json.Str(o["to"]) ?? "",
        Label = o.ContainsKey("label") ? Json.Str(o["label"]) : "",
        Kind = o.ContainsKey("kind") ? Json.Str(o["kind"]) : "uses",
        Layer = Json.Str(o["layer"]) ?? "default",
        Style = o["style"] is JsonObject style ? (JsonObject)style.DeepClone() : null,
        Hero = Json.Truthy(o["hero"]),
        Transport = Json.Str(o["transport"]),
        Origin = Json.Str(o["origin"]),
    };
}

public static class CanvasIds
{
    public static string New() => Guid.NewGuid().ToString("N");
}

/// <summary>The assembled in-memory document: core geometry plus every diagram's projection, never one file.</summary>
public sealed class CanvasDoc
{
    public const int SchemaVersion = 1;

    /// <summary>The `render` values a v1 element may carry; kept in step with web/src/canvas/doc/elementRules.ts.</summary>
    public static readonly IReadOnlyList<string> RenderKinds =
        ["hierarchy", "c1", "pattern", "impact", "epic", "spec", "task", "custom", "group", "note", "sequence", "question"];

    /// <summary>Layers with no diagram of their own; kept in step with diagramCatalog.ts's NON_DIAGRAM_LAYERS.</summary>
    public static readonly IReadOnlySet<string> NonDiagramLayers = new HashSet<string> { "default", "hierarchy", "questions", "decisions" };

    public int Version { get; set; } = SchemaVersion;
    public string DocId { get; set; } = CanvasIds.New();
    public string UpdatedAt { get; set; } = "";
    public InsertionMap<CanvasElement> Elements { get; } = new();
    public InsertionMap<CanvasEdge> Edges { get; } = new();

    public CanvasDoc Clone()
    {
        var copy = new CanvasDoc { Version = Version, DocId = DocId, UpdatedAt = UpdatedAt };
        foreach (var (id, element) in Elements) copy.Elements[id] = element.Clone();
        foreach (var (id, edge) in Edges) copy.Edges[id] = edge.Clone();
        return copy;
    }

    public JsonObject ToJson()
    {
        var elements = new JsonObject();
        foreach (var (id, element) in Elements) elements[id] = element.ToJson();
        var edges = new JsonObject();
        foreach (var (id, edge) in Edges) edges[id] = edge.ToJson();
        return new JsonObject
        {
            ["schema_version"] = Version,
            ["doc_id"] = DocId,
            ["updated_at"] = UpdatedAt,
            ["elements"] = elements,
            ["edges"] = edges,
        };
    }

    /// <summary>Assembles core content and geometry plus every diagram's own projection into one document.</summary>
    public static CanvasDoc Load(string canvasCorePath, string diagramsRoot)
    {
        var core = ReadObject(canvasCorePath);
        var doc = new CanvasDoc();
        if (core["schema_version"] is JsonValue sv && sv.TryGetValue(out int version)) doc.Version = version;
        if (Json.Str(core["doc_id"]) is { } docId) doc.DocId = docId;
        doc.UpdatedAt = Json.Str(core["updated_at"]) ?? "";

        // The code-tree block was retired; "hierarchy" stays a valid render only so old files load.
        foreach (var (id, node) in core["elements"] as JsonObject ?? [])
            if (node is JsonObject e && CanvasElement.FromJson(e) is { Render: not "hierarchy" } element) doc.Elements[id] = element;
        foreach (var (id, node) in core["edges"] as JsonObject ?? [])
            if (node is JsonObject e) doc.Edges[id] = CanvasEdge.FromJson(e);
        var positions = core["positions"] as JsonObject ?? [];

        foreach (var projectionPath in ProjectionFiles(diagramsRoot))
        {
            var projection = ReadObject(projectionPath);
            foreach (var (id, node) in projection["elements"] as JsonObject ?? [])
            {
                if (node is not JsonObject e) continue;
                var element = CanvasElement.FromJson(e);
                if (positions[id] is JsonObject record)
                {
                    element.Position = CanvasPosition.FromJson(record["position"]);
                    element.Size = CanvasSize.FromJson(record["size"]);
                }
                doc.Elements[id] = element;
            }
            foreach (var (id, node) in projection["edges"] as JsonObject ?? [])
                if (node is JsonObject e) doc.Edges[id] = CanvasEdge.FromJson(e);
        }
        return doc;
    }

    /// <summary>Splits by layer and writes every touched or now-empty file; returns the paths that failed.</summary>
    public List<string> Save(string canvasCorePath, string diagramsRoot)
    {
        UpdatedAt = DateTimeOffset.UtcNow.ToString("O");
        var core = new JsonObject
        {
            ["schema_version"] = Version,
            ["doc_id"] = DocId,
            ["updated_at"] = UpdatedAt,
        };
        var positions = new JsonObject();
        var coreElements = new JsonObject();
        var coreEdges = new JsonObject();
        var projections = new Dictionary<string, (JsonObject Elements, JsonObject Edges)>(StringComparer.Ordinal);

        (JsonObject Elements, JsonObject Edges) ProjectionFor(string layer)
        {
            if (!projections.TryGetValue(layer, out var projection)) projections[layer] = projection = ([], []);
            return projection;
        }

        foreach (var (id, element) in Elements)
        {
            if (LayerPath(diagramsRoot, element.Layer) is null)
            {
                coreElements[id] = element.ToJson();
                continue;
            }
            positions[id] = new JsonObject { ["position"] = element.Position.ToJson(), ["size"] = element.Size?.ToJson() };
            var content = element.Clone();
            content.Position = new CanvasPosition();
            content.Size = null;
            ProjectionFor(element.Layer).Elements[id] = content.ToJson();
        }
        foreach (var (id, edge) in Edges)
        {
            if (LayerPath(diagramsRoot, edge.Layer) is null) coreEdges[id] = edge.ToJson();
            else ProjectionFor(edge.Layer).Edges[id] = edge.ToJson();
        }
        core["positions"] = positions;
        core["elements"] = coreElements;
        core["edges"] = coreEdges;

        var failed = new List<string>();
        var stale = ProjectionFiles(diagramsRoot).Where(path => !projections.ContainsKey(LayerFor(diagramsRoot, path))).ToList();
        foreach (var (layer, projection) in projections)
        {
            var path = LayerPath(diagramsRoot, layer)!;
            if (!WriteAtomic(path, new JsonObject { ["elements"] = projection.Elements, ["edges"] = projection.Edges })) failed.Add(path);
        }
        foreach (var path in stale)
            if (!WriteAtomic(path, new JsonObject { ["elements"] = new JsonObject(), ["edges"] = new JsonObject() })) failed.Add(path);
        if (!WriteAtomic(canvasCorePath, core)) failed.Add(canvasCorePath);
        return failed;
    }

    private static JsonObject ReadObject(string path)
    {
        try
        {
            return JsonNode.Parse(File.ReadAllText(path)) as JsonObject ?? [];
        }
        catch (Exception error) when (error is IOException or JsonException or UnauthorizedAccessException)
        {
            return [];
        }
    }

    private static IEnumerable<string> ProjectionFiles(string diagramsRoot) =>
        Directory.Exists(diagramsRoot)
            ? Directory.EnumerateFiles(diagramsRoot, "projection.json", SearchOption.AllDirectories).Order(StringComparer.Ordinal)
            : [];

    /// <summary>The layer string a `diagramsRoot/**/projection.json` path was written under.</summary>
    private static string LayerFor(string diagramsRoot, string projectionPath) =>
        string.Join("/", Path.GetRelativePath(diagramsRoot, Path.GetDirectoryName(projectionPath)!)
            .Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            .Where(part => part != "."));

    /// <summary>The projection file for a diagram layer; null for a non-diagram layer or one that escapes the root.</summary>
    private static string? LayerPath(string diagramsRoot, string layer)
    {
        if (NonDiagramLayers.Contains(layer)) return null;
        var candidate = Path.GetFullPath(Path.Combine([diagramsRoot, .. layer.Split('/'), "projection.json"]));
        var root = Path.GetFullPath(diagramsRoot);
        var inside = candidate.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        return inside ? candidate : null;
    }

    private static bool WriteAtomic(string path, JsonNode payload)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temp = $"{path}.{Environment.ProcessId}.{Guid.NewGuid():N}.json.tmp";
            File.WriteAllText(temp, payload.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
            File.Move(temp, path, overwrite: true);
            return true;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }
}
