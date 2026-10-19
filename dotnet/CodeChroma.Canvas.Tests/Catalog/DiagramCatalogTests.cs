namespace CodeChroma.Canvas.Tests.Catalog;

public class DiagramCatalogTests
{
    private const string File = "diagram_catalog.json";

    public static IEnumerable<object[]> FlagCases => Fx.Cases(File, "layerFlags");
    public static IEnumerable<object[]> ActiveCases => Fx.Cases(File, "activeLayers");
    public static IEnumerable<object[]> LabelCases => Fx.Cases(File, "labels");
    public static IEnumerable<object[]> ReadyCases => Fx.Cases(File, "ready");
    public static IEnumerable<object[]> TaskCases => Fx.Cases("draw_diagram_task.json", "cases");

    private static CanvasDoc DocOf(JsonElement elements) =>
        Fx.DocOf(elements.EnumerateArray().Select(e => Fx.Element(
            e.GetProperty("id").GetString()!,
            layer: e.GetProperty("layer").GetString()!,
            render: e.TryGetProperty("render", out var r) ? Fx.Kind(r.GetString()!) : RenderKind.C1,
            label: e.TryGetProperty("label", out var l) ? l.GetString()! : "",
            meta: e.TryGetProperty("recipe_key", out var k) ? new Dictionary<string, object?> { ["recipe_key"] = k.GetString() } : null)).ToArray());

    private static List<DiagramTypeSummary> Custom(JsonElement types) =>
        types.EnumerateArray().Select(t => new DiagramTypeSummary(t.GetProperty("id").GetString()!, t.GetProperty("title").GetString()!)).ToList();

    private static string[] Strings(JsonElement a) => a.EnumerateArray().Select(x => x.GetString()!).ToArray();

    [Theory, MemberData(nameof(FlagCases))]
    public void A_layer_is_classified_as_diagram_recipe_backed_and_deletable(string name, string json)
    {
        var c = Fx.Parse(json);
        var layer = c.GetProperty("layer").GetString()!;

        Assert.Equal(c.GetProperty("isDiagram").GetBoolean(), DiagramCatalog.IsDiagramLayer(layer));
        Assert.Equal(c.GetProperty("isRecipeBacked").GetBoolean(), DiagramCatalog.IsRecipeBackedLayer(layer));
        Assert.Equal(c.GetProperty("isDeletable").GetBoolean(), DiagramCatalog.HasDeletableDiagramArtifact(layer));
    }

    [Theory, MemberData(nameof(ActiveCases))]
    public void Active_diagram_layers_are_the_distinct_non_seed_layers_on_the_doc(string name, string json)
    {
        var c = Fx.Parse(json);

        var layers = DiagramCatalog.ListActiveDiagramLayers(DocOf(c.GetProperty("elements")));

        Assert.Equal(Strings(c.GetProperty("expected")).OrderBy(x => x), layers.OrderBy(x => x));
    }

    [Theory, MemberData(nameof(LabelCases))]
    public void A_layer_resolves_to_its_display_label(string name, string json)
    {
        var c = Fx.Parse(json);

        var label = DiagramCatalog.LabelForDiagramLayer(c.GetProperty("layer").GetString()!, Custom(c.GetProperty("custom")), DocOf(c.GetProperty("elements")));

        Assert.Equal(c.GetProperty("expected").GetString(), label);
    }

    [Theory, MemberData(nameof(ReadyCases))]
    public void ComputeReady_splits_ready_from_missing_and_fails_open_without_a_status(string name, string json)
    {
        var c = Fx.Parse(json);
        DiagramsStatus? status = c.GetProperty("status").ValueKind == JsonValueKind.Null
            ? null
            : new DiagramsStatus(c.GetProperty("status").EnumerateObject().ToDictionary(
                p => p.Name,
                p => new DiagramStatusEntry(p.Value.GetProperty("ready").GetBoolean(),
                    p.Value.TryGetProperty("fingerprint", out var fp) && fp.ValueKind == JsonValueKind.String ? fp.GetString() : null)));

        var ready = DiagramCatalog.ComputeReadyDiagrams(status, Custom(c.GetProperty("custom")), Strings(c.GetProperty("active")).ToHashSet());

        Assert.Equal(Strings(c.GetProperty("readyBuiltins")).OrderBy(x => x), ready.ReadyBuiltins.Select(r => r.Name).OrderBy(x => x));
        Assert.Equal(Strings(c.GetProperty("readyCustom")), ready.ReadyCustomTypes.Select(t => t.Id).ToArray());
        Assert.Equal(Strings(c.GetProperty("missing")).OrderBy(x => x), ready.MissingLabels.OrderBy(x => x));
        if (c.TryGetProperty("allLabels", out var all)) Assert.Equal(Strings(all).OrderBy(x => x), ready.AllLabels.OrderBy(x => x));
    }

    [Fact]
    public void Epics_is_among_the_watched_diagram_event_kinds_so_a_written_epics_json_auto_places()
    {
        Assert.Contains("epics", DiagramCatalog.WatchedDiagramEventKinds);
    }

    [Theory, MemberData(nameof(TaskCases))]
    public void The_draw_prompt_enumerates_kinds_asks_in_plain_text_past_four_and_says_another(string name, string json)
    {
        var c = Fx.Parse(json);

        var task = DiagramCatalog.BuildDrawDiagramTask(Strings(c.GetProperty("labels")), c.GetProperty("anyReady").GetBoolean());

        foreach (var s in Strings(c.GetProperty("contains"))) Assert.Contains(s, task);
        foreach (var s in Strings(c.GetProperty("notContains"))) Assert.DoesNotContain(s, task);
    }
}
