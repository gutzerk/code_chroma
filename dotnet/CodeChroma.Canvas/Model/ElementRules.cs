namespace CodeChroma.Canvas.Model;

/// <summary>How the canvas treats one render kind (elementRules.ts BLOCK_RULES, minus the CSS class strings).</summary>
public sealed record BlockRule(RenderKind Kind, string Renderer, string Activation, string? Overlay, string? StatusChip, bool LockedLayout);

/// <summary>The element-kind rule registry: add a kind here and renderer, overlay, activation and layout lock follow.</summary>
public static class ElementRules
{
    private static readonly BlockRule[] Rules =
    {
        new(RenderKind.Hierarchy, "hierarchy", "inspector", null, null, false),
        new(RenderKind.Note, "note", "inspector", null, null, false),
        new(RenderKind.Group, "group", "inspector", null, null, false),
        new(RenderKind.Sequence, "sequence", "inspector", null, null, true),
        new(RenderKind.C1, "node-box", "inspector", null, null, false),
        new(RenderKind.Pattern, "node-box", "inspector", null, null, false),
        new(RenderKind.Impact, "node-box", "inspector", "impact", "impact", false),
        new(RenderKind.Epic, "node-box", "epic-brief", null, null, true),
        new(RenderKind.Spec, "node-box", "epic-brief", null, null, true),
        new(RenderKind.Task, "node-box", "inspector", null, null, true),
        new(RenderKind.Custom, "node-box", "inspector", null, null, false),
    };

    private static readonly Dictionary<RenderKind, BlockRule> ByKind = Rules.ToDictionary(r => r.Kind);

    public static IReadOnlyList<BlockRule> All => Rules;

    public static BlockRule For(RenderKind kind) => ByKind[kind];

    public static RenderKind ParseKind(string wire) =>
        Enum.TryParse<RenderKind>(wire, ignoreCase: true, out var kind) ? kind : throw new FormatException($"unknown render kind '{wire}'");

    public static string ToWire(RenderKind kind) => kind.ToString().ToLowerInvariant();

    /// <summary>Epics diagrams anchor a box at its bottom-left corner; every other kind centres on its position.</summary>
    public static bool IsBottomLeft(RenderKind kind) => kind is RenderKind.Epic or RenderKind.Spec or RenderKind.Task;
}
