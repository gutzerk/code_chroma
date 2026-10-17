namespace CodeChroma.Canvas.Model;

/// <summary>
/// One accent decision per box as semantic values, not CSS classes: Icon is "brand:slug" or "kind:name", Group indexes the
/// shared palette, NoCode is a recognised reason. The view maps these onto brushes.
/// </summary>
public sealed record NodeAccent(string? Icon, string? Kind, string? Status, int? Group, string? Shape, string? NoCode)
{
    public static readonly NodeAccent None = new(null, null, null, null, null, null);
}

/// <summary>The box's top band: the plan role and the step number.</summary>
public sealed record TopBand(string? Plan, string? Order);

/// <summary>Pure accent, chip and message logic (nodeAccentLogic.tsx and the chip text of nodeAccent.tsx).</summary>
public static class NodeAccents
{
    public const int GroupColorCount = 6;

    private static readonly HashSet<string> IconKinds = new()
    {
        "system", "person", "external_system", "api", "ui", "service", "database", "queue", "cache", "worker", "auth",
    };

    private static readonly HashSet<string> Shapes = new() { "database", "client", "queue", "actor", "cache", "storage", "external" };
    private static readonly Dictionary<string, string> NoCodeLabels = new() { ["conceptual"] = "CONCEPTUAL", ["external"] = "EXTERNAL", ["unresolved"] = "UNRESOLVED" };
    private static readonly Dictionary<string, string> ImpactLabels = new() { ["new"] = "ADD", ["modified"] = "MODIFY", ["deleted"] = "DELETE" };
    private static readonly Dictionary<string, string> ImpactMarks = new() { ["new"] = "+", ["modified"] = "~", ["deleted"] = "−" };
    private static readonly Dictionary<string, string> PlanLabels = new() { ["add"] = "ADD", ["create"] = "CREATE", ["modify"] = "MODIFY", ["delete"] = "DELETE" };

    /// <summary>Hashes a group name into the shared palette (31-multiplier, uint32 wrap, as the web does).</summary>
    public static int GroupColorIndex(string name)
    {
        uint hash = 0;
        foreach (var ch in name) hash = unchecked(hash * 31 + ch);
        return (int)(hash % GroupColorCount);
    }

    public static NodeAccent AccentFor(CanvasElement element, Func<string, bool> isKnownBrand)
    {
        string? icon = null;
        var brand = ElementMeta.String(element, "icon");
        var kind = ElementMeta.String(element, "kind");
        if (brand is not null && isKnownBrand(brand)) icon = $"brand:{brand}";
        else if (kind is not null && IconKinds.Contains(kind)) icon = $"kind:{kind}";

        var status = ElementMeta.String(element, "status");
        if (status == "new") status = "added";
        var group = ElementMeta.String(element, "group");
        var shape = ElementMeta.String(element, "shape");
        var reason = ElementMeta.String(element, "no_code_reason");

        var accent = new NodeAccent(
            icon, kind, status,
            group is null ? null : GroupColorIndex(group),
            shape is not null && Shapes.Contains(shape) ? shape : null,
            reason is not null && NoCodeLabels.ContainsKey(reason) ? reason : null);
        return accent == NodeAccent.None ? NodeAccent.None : accent;
    }

    public static TopBand? TopBandOf(CanvasElement element)
    {
        var planKind = ElementMeta.String(element, "plan_kind");
        var plan = planKind is not null && PlanLabels.TryGetValue(planKind, out var label) ? $"PLAN · {label}" : null;
        var order = ElementMeta.String(element, "order");
        if (plan is null && order is null) return null;
        return new TopBand(plan, order is null ? null : $"STEP {order}");
    }

    public static string? ImpactChipOf(CanvasElement element, int? count = null)
    {
        if (ElementRules.For(element.Render).StatusChip != "impact") return null;
        var status = ElementMeta.String(element, "status");
        if (status is null || !ImpactLabels.ContainsKey(status)) return null;
        var suffix = count is > 0 ? $" · {count}" : "";
        return $"{ImpactMarks[status]} {ImpactLabels[status]}{suffix}";
    }

    public static string? NoCodeChipOf(CanvasElement element)
    {
        var reason = ElementMeta.String(element, "no_code_reason");
        return reason is not null && NoCodeLabels.TryGetValue(reason, out var label) ? $"∅ {label}" : null;
    }

    /// <summary>The inline chip row: epic brief tags for an epic, otherwise impact status then no-code reason.</summary>
    public static IReadOnlyList<string> MetaRowOf(CanvasElement element)
    {
        if (element.Render == RenderKind.Epic)
        {
            var chips = new List<string>();
            foreach (var key in new[] { "status", "priority", "group" })
                if (ElementMeta.String(element, key) is { } value) chips.Add(value);
            if (ElementMeta.String(element, "depends_on") is { } dep) chips.Add($"depends_on → {dep}");
            return chips;
        }
        return new[] { ImpactChipOf(element), NoCodeChipOf(element) }.Where(c => c is not null).Select(c => c!).ToList();
    }

    /// <summary>The description-popup body for a no-code box: authored text wins, then the canned reason.</summary>
    public static string NoCodeReasonMessage(CanvasElement element, string reason)
    {
        var authored = ElementMeta.String(element, "details") ?? (element.Description.Length > 0 ? element.Description : null);
        if (authored is not null) return authored;
        var baseMessage = reason switch
        {
            "conceptual" => "This box stands for a concept, not a specific piece of code — there's nothing to open.",
            "external" => "This box is an external system outside this codebase — there's no code here to open.",
            "unresolved" => "This box's path could not be matched to any code in the graph — it may have moved, been renamed, or the diagram may be out of date.",
            _ => "This box has no linked code.",
        };
        var detail = ElementMeta.String(element, "no_code_detail");
        return reason == "unresolved" && detail is not null ? $"{baseMessage} (authored path: \"{detail}\")" : baseMessage;
    }
}
