namespace CodeChroma.Canvas.Catalog;

public sealed record BuiltinRecipe(string Name, string Label, bool Generated);

public sealed record ReadyDiagrams(
    IReadOnlyList<BuiltinRecipe> ReadyBuiltins, IReadOnlyList<DiagramTypeSummary> ReadyCustomTypes,
    IReadOnlyList<string> MissingLabels, IReadOnlyList<string> AllLabels, bool AnyGeneratedReady);

/// <summary>Pure diagram-layer classification, labelling and readiness logic (diagramCatalog.ts).</summary>
public static class DiagramCatalog
{
    public static readonly IReadOnlyList<BuiltinRecipe> BuiltinRecipes = new BuiltinRecipe[]
    {
        new("system-context", "System context", true),
        new("patterns", "Design patterns", true),
        new("impact", "Change impact", true),
        new("epics", "Epics", true),
        new("sequence", "Sequence", true),
    };

    public static readonly IReadOnlyList<string> WatchedDiagramEventKinds =
        new[] { "system-context", "epics", "patterns", "impact", "sequence", "custom", "feature-plan" };

    private static readonly HashSet<string> NonDiagramLayers = new() { "hierarchy", "default", "questions", "decisions" };
    private const string CanvasOnlyPrefix = "decisions/";
    private static readonly string[] SynthesizedPrefixes = { "custom/", "feature-plan/", "epics/" };

    /// <summary>Everything except the seeded hierarchy tree, the fallback and question layers is a diagram (a deny-list, on purpose); `decisions/*` option diagrams are diagrams with no file artifact.</summary>
    public static bool IsDiagramLayer(string layer) => layer.StartsWith(CanvasOnlyPrefix, StringComparison.Ordinal) || !NonDiagramLayers.Contains(layer);

    /// <summary>Whether a recipe run can reconcile this layer (a builtin or a synthesized prefix), as opposed to a one-off layer.</summary>
    public static bool IsRecipeBackedLayer(string layer) =>
        BuiltinRecipes.Any(r => r.Name == layer) || SynthesizedPrefixes.Any(p => layer.StartsWith(p, StringComparison.Ordinal));

    /// <summary>Whether the layer has an on-disk artifact a delete should also remove.</summary>
    public static bool HasDeletableDiagramArtifact(string layer)
    {
        var builtin = BuiltinRecipes.FirstOrDefault(r => r.Name == layer);
        return builtin is not null ? builtin.Generated : IsRecipeBackedLayer(layer);
    }

    public static IReadOnlyList<string> ListActiveDiagramLayers(CanvasDoc doc) =>
        doc.Elements.Values.Select(e => e.Layer).Distinct().Where(IsDiagramLayer).ToList();

    public static string LabelForDiagramLayer(string layer, IReadOnlyList<DiagramTypeSummary> customTypes, CanvasDoc? doc = null)
    {
        if (EpicsLayout.IsEpicsLayerName(layer) && doc is not null && EpicsLayerShortTitle(doc, layer) is { } title) return title;
        var builtin = BuiltinRecipes.FirstOrDefault(r => r.Name == layer);
        if (builtin is not null) return builtin.Label;
        var custom = customTypes.FirstOrDefault(t => $"custom/{t.Id}" == layer);
        if (custom is not null) return custom.Title;
        if (layer.StartsWith("feature-plan/", StringComparison.Ordinal)) return $"Feature plan: {layer["feature-plan/".Length..]}";
        if (layer.StartsWith("epics/", StringComparison.Ordinal)) return layer["epics/".Length..];
        return layer;
    }

    /// <summary>The short title of the first top-level epic box (recipe_key equal to its own parent epic key), or null.</summary>
    public static string? EpicsLayerShortTitle(CanvasDoc doc, string layer)
    {
        var epic = doc.Elements.Values.FirstOrDefault(e =>
        {
            if (e.Layer != layer) return false;
            var key = ElementMeta.String(e, "recipe_key") ?? e.Id;
            return ParentEpicKey(key) == key;
        });
        return epic is null ? null : System.Text.RegularExpressions.Regex.Replace(epic.Label, @"^EP-\d+ ·\s*", "");
    }

    /// <summary>The top-level epic key a recipe_key belongs to: "EP-3-01" is "EP-3"; a bare "EP-1" names itself.</summary>
    public static string ParentEpicKey(string key)
    {
        var m = System.Text.RegularExpressions.Regex.Match(key, @"^(EP-\d+)-");
        return m.Success ? m.Groups[1].Value : key;
    }

    /// <summary>Fails open: an unknown status (null) counts as ready, since this only hides clicks that would no-op, never diagrams that exist.</summary>
    public static ReadyDiagrams ComputeReadyDiagrams(DiagramsStatus? status, IReadOnlyList<DiagramTypeSummary> customTypes, ISet<string> activeLayers)
    {
        bool IsReady(string name)
        {
            if (status is null) return true;
            return status.Entries.TryGetValue(name, out var entry) ? entry.Ready : activeLayers.Contains(name);
        }
        bool BuiltinReady(BuiltinRecipe r) => !r.Generated || IsReady(r.Name);
        bool CustomReady(DiagramTypeSummary t) => IsReady($"custom/{t.Id}");

        var readyBuiltins = BuiltinRecipes.Where(BuiltinReady).ToList();
        var readyCustom = customTypes.Where(CustomReady).ToList();
        var missing = BuiltinRecipes.Where(r => !BuiltinReady(r)).Select(r => r.Label)
            .Concat(customTypes.Where(t => !CustomReady(t)).Select(t => t.Title)).ToList();
        var all = BuiltinRecipes.Select(r => r.Label).Concat(customTypes.Select(t => t.Title)).ToList();
        return new ReadyDiagrams(readyBuiltins, readyCustom, missing, all, readyBuiltins.Any(r => r.Generated) || readyCustom.Count > 0);
    }

    /// <summary>The agent's draw prompt; with more than four kinds it asks in plain text so a multiple-choice tool cap is never hit.</summary>
    public static string BuildDrawDiagramTask(IReadOnlyList<string> labels, bool anyAlreadyReady)
    {
        var article = anyAlreadyReady ? "another" : "a";
        if (labels.Count == 0)
            return $"The user wants {article} diagram of this project. Every built-in and saved diagram type is already drawn -- ask what new diagram they'd like (redrawing something existing, or a fresh one-off custom diagram), then use the codechroma-draw-diagram skill to draw it.";
        var hint = labels.Count > 4 ? " (more than 4 -- list them in your reply as plain text, not a multiple-choice tool call)" : "";
        return $"The user wants {article} diagram of this project. Ask which kind they'd like{hint} -- {string.Join(", ", labels)} -- then use the codechroma-draw-diagram skill and pick the matching type from its router table to draw it.";
    }
}
