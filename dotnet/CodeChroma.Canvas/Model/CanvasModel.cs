using System.Text.Json;
using System.Text.Json.Serialization;

namespace CodeChroma.Canvas.Model;

/// <summary>The render kinds a v1 element may carry (canvas/document.py RENDER_KINDS).</summary>
[JsonConverter(typeof(RenderKindConverter))]
public enum RenderKind { Hierarchy, C1, Pattern, Impact, Epic, Spec, Task, Custom, Group, Note, Sequence }

internal sealed class RenderKindConverter : JsonConverter<RenderKind>
{
    public override RenderKind Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        ElementRules.ParseKind(reader.GetString() ?? "note");

    public override void Write(Utf8JsonWriter writer, RenderKind value, JsonSerializerOptions options) =>
        writer.WriteStringValue(ElementRules.ToWire(value));
}

public sealed record Position([property: JsonPropertyName("x")] double X, [property: JsonPropertyName("y")] double Y);

public sealed record Size([property: JsonPropertyName("w")] double W, [property: JsonPropertyName("h")] double H);

/// <summary>One box on the canvas; wire shape verbatim from canvas/document.py's Element.</summary>
public sealed record CanvasElement
{
    [JsonPropertyName("id")] public string Id { get; init; } = "";
    [JsonPropertyName("render")] public RenderKind Render { get; init; } = RenderKind.Note;
    [JsonPropertyName("layer")] public string Layer { get; init; } = "default";
    [JsonPropertyName("label")] public string Label { get; init; } = "";
    [JsonPropertyName("description")] public string Description { get; init; } = "";
    [JsonPropertyName("node_id")] public string? NodeId { get; init; }
    [JsonPropertyName("position")] public Position Position { get; init; } = new(0, 0);
    [JsonPropertyName("size")] public Size? Size { get; init; }
    [JsonPropertyName("group_id")] public string? GroupId { get; init; }
    [JsonPropertyName("meta")] public IReadOnlyDictionary<string, JsonElement> Meta { get; init; } = new Dictionary<string, JsonElement>();
    [JsonPropertyName("created_by")] public string CreatedBy { get; init; } = "ai";
    [JsonPropertyName("style")] public IReadOnlyDictionary<string, string>? Style { get; init; }
}

/// <summary>One arrow between two elements.</summary>
public sealed record CanvasEdge
{
    [JsonPropertyName("id")] public string Id { get; init; } = "";
    [JsonPropertyName("from")] public string From { get; init; } = "";
    [JsonPropertyName("to")] public string To { get; init; } = "";
    [JsonPropertyName("label")] public string Label { get; init; } = "";
    [JsonPropertyName("kind")] public string Kind { get; init; } = "";
    [JsonPropertyName("layer")] public string Layer { get; init; } = "";
    [JsonPropertyName("transport")] public string? Transport { get; init; }
    [JsonPropertyName("hero")] public bool? Hero { get; init; }
    [JsonPropertyName("style")] public IReadOnlyDictionary<string, string>? Style { get; init; }
    [JsonPropertyName("origin")] public string? Origin { get; init; }
}

/// <summary>GET /repos/{id}/canvas's whole payload.</summary>
public sealed record CanvasDoc
{
    private static readonly JsonSerializerOptions Options = new() { DefaultIgnoreCondition = JsonIgnoreCondition.Never };

    public static readonly CanvasDoc Empty = new();

    [JsonPropertyName("schema_version")] public int SchemaVersion { get; init; } = 1;
    [JsonPropertyName("doc_id")] public string DocId { get; init; } = "";
    [JsonPropertyName("updated_at")] public string UpdatedAt { get; init; } = "";
    [JsonPropertyName("elements")] public IReadOnlyDictionary<string, CanvasElement> Elements { get; init; } = new Dictionary<string, CanvasElement>();
    [JsonPropertyName("edges")] public IReadOnlyDictionary<string, CanvasEdge> Edges { get; init; } = new Dictionary<string, CanvasEdge>();

    public static CanvasDoc FromJson(string json) => JsonSerializer.Deserialize<CanvasDoc>(json, Options) ?? Empty;

    public string ToJson() => JsonSerializer.Serialize(this, Options);
}

/// <summary>One op inside a PATCH /repos/{id}/canvas batch (only the fields the canvas logic writes).</summary>
public sealed record CanvasOp(string Op, string? Id = null, Position? Position = null, Size? Size = null);

public sealed record CanvasBatch(IReadOnlyList<CanvasOp> Ops, string Layer, string Explanation, bool ConfirmMassDelete);

public sealed record DiagramStatusEntry(bool Ready, string? Fingerprint);

public sealed record DiagramsStatus(IReadOnlyDictionary<string, DiagramStatusEntry> Entries);

public sealed record DiagramTypeSummary(string Id, string Title);

/// <summary>Typed reads off an element's free-form meta bag (elementMeta.ts).</summary>
public static class ElementMeta
{
    /// <summary>A non-empty string value, or null for anything else.</summary>
    public static string? String(CanvasElement element, string key) =>
        element.Meta.TryGetValue(key, out var v) && v.ValueKind == JsonValueKind.String && v.GetString() is { Length: > 0 } s ? s : null;

    /// <summary>A string or number value (a numeric authored order survives), else null.</summary>
    public static object? Raw(CanvasElement element, string key)
    {
        if (!element.Meta.TryGetValue(key, out var v)) return null;
        return v.ValueKind switch
        {
            JsonValueKind.String => v.GetString(),
            JsonValueKind.Number => v.GetDouble(),
            _ => null,
        };
    }

    /// <summary>Truthiness across the JSON boolean the backend emits and the "true" string authored files use.</summary>
    public static bool Flag(CanvasElement element, string key)
    {
        if (!element.Meta.TryGetValue(key, out var v)) return false;
        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.String => v.GetString() != "",
            JsonValueKind.Number => v.GetDouble() != 0,
            _ => false,
        };
    }

    /// <summary>The leading ASCII digit run of an authored order in normalised numeric form ("02a" becomes "2").</summary>
    public static string? LeadingOrderDigits(string? order)
    {
        if (string.IsNullOrEmpty(order)) return null;
        var end = 0;
        while (end < order.Length && order[end] is >= '0' and <= '9') end++;
        if (end == 0) return null;
        return System.Numerics.BigInteger.Parse(order[..end]).ToString();
    }
}
