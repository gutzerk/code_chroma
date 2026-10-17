using System.Text.Json;

namespace CodeChroma.Canvas.Model;

public enum RenderKind { Hierarchy, C1, Pattern, Impact, Epic, Spec, Task, Custom, Group, Note, Sequence }

public sealed record Position(double X, double Y);

public sealed record Size(double W, double H);

public sealed record CanvasElement
{
    public string Id { get; init; } = "";
    public RenderKind Render { get; init; } = RenderKind.Note;
    public string Layer { get; init; } = "default";
    public string Label { get; init; } = "";
    public string Description { get; init; } = "";
    public string? NodeId { get; init; }
    public Position Position { get; init; } = new(0, 0);
    public Size? Size { get; init; }
    public string? GroupId { get; init; }
    public IReadOnlyDictionary<string, JsonElement> Meta { get; init; } = new Dictionary<string, JsonElement>();
    public string CreatedBy { get; init; } = "ai";
    public IReadOnlyDictionary<string, string>? Style { get; init; }
}

public sealed record CanvasEdge
{
    public string Id { get; init; } = "";
    public string From { get; init; } = "";
    public string To { get; init; } = "";
    public string Label { get; init; } = "";
    public string Kind { get; init; } = "";
    public string Layer { get; init; } = "";
    public string? Transport { get; init; }
    public bool? Hero { get; init; }
    public IReadOnlyDictionary<string, string>? Style { get; init; }
    public string? Origin { get; init; }
}

public sealed record CanvasDoc
{
    public static readonly CanvasDoc Empty = new();
    public int SchemaVersion { get; init; } = 1;
    public string DocId { get; init; } = "";
    public string UpdatedAt { get; init; } = "";
    public IReadOnlyDictionary<string, CanvasElement> Elements { get; init; } = new Dictionary<string, CanvasElement>();
    public IReadOnlyDictionary<string, CanvasEdge> Edges { get; init; } = new Dictionary<string, CanvasEdge>();
    public static CanvasDoc FromJson(string json) => throw new NotImplementedException();
    public string ToJson() => throw new NotImplementedException();
}

public sealed record CanvasOp(string Op, string? Id = null, Position? Position = null, Size? Size = null);

public sealed record CanvasBatch(IReadOnlyList<CanvasOp> Ops, string Layer, string Explanation, bool ConfirmMassDelete);

public sealed record DiagramStatusEntry(bool Ready, string? Fingerprint);

public sealed record DiagramsStatus(IReadOnlyDictionary<string, DiagramStatusEntry> Entries);

public sealed record DiagramTypeSummary(string Id, string Title);

public static class ElementMeta
{
    public static string? String(CanvasElement element, string key) => throw new NotImplementedException();
    public static object? Raw(CanvasElement element, string key) => throw new NotImplementedException();
    public static bool Flag(CanvasElement element, string key) => throw new NotImplementedException();
    public static string? LeadingOrderDigits(string? order) => throw new NotImplementedException();
}

public sealed record BlockRule(RenderKind Kind, string Renderer, string Activation, string? Overlay, string? StatusChip, bool LockedLayout);

public static class ElementRules
{
    public static IReadOnlyList<BlockRule> All => throw new NotImplementedException();
    public static BlockRule For(RenderKind kind) => throw new NotImplementedException();
    public static RenderKind ParseKind(string wire) => throw new NotImplementedException();
    public static string ToWire(RenderKind kind) => throw new NotImplementedException();
    public static bool IsBottomLeft(RenderKind kind) => throw new NotImplementedException();
}

public sealed record NodeAccent(string? Icon, string? Kind, string? Status, int? Group, string? Shape, string? NoCode)
{
    public static readonly NodeAccent None = new(null, null, null, null, null, null);
}

public sealed record TopBand(string? Plan, string? Order);

public static class NodeAccents
{
    public const int GroupColorCount = 6;
    public static int GroupColorIndex(string name) => throw new NotImplementedException();
    public static NodeAccent AccentFor(CanvasElement element, Func<string, bool> isKnownBrand) => throw new NotImplementedException();
    public static TopBand? TopBandOf(CanvasElement element) => throw new NotImplementedException();
    public static string? ImpactChipOf(CanvasElement element, int? count = null) => throw new NotImplementedException();
    public static string? NoCodeChipOf(CanvasElement element) => throw new NotImplementedException();
    public static IReadOnlyList<string> MetaRowOf(CanvasElement element) => throw new NotImplementedException();
    public static string NoCodeReasonMessage(CanvasElement element, string reason) => throw new NotImplementedException();
}
