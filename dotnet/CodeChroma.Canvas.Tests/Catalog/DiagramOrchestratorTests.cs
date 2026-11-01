namespace CodeChroma.Canvas.Tests.Catalog;

/// <summary>The stateful half of diagramCatalog.test.ts: remove/re-add keeps positions, a recipe run never flashes the (0,0) pile, delete order.</summary>
public class DiagramOrchestratorTests
{
    private static readonly Position Dragged = new(540, 320);

    private static CanvasDoc DocWithElement(string id, Position position, string layer = "c1") =>
        Fx.DocOf(Fx.Element(id, layer: layer, x: position.X, y: position.Y, label: "System", meta: new Dictionary<string, object?> { ["recipe_key"] = "n1" }));

    private static (DiagramOrchestrator Orchestrator, CanvasDocStore Store, LayerPositionCache Cache) Build(FakeBridge bridge)
    {
        var store = new CanvasDocStore();
        var cache = new LayerPositionCache();
        return (new DiagramOrchestrator(bridge, store, cache, new DiagramHealthStore()), store, cache);
    }

    [Fact]
    public async Task Remove_then_re_add_restores_a_dragged_position_instead_of_running_auto_layout()
    {
        var bridge = new FakeBridge { GetCanvas = () => Task.FromResult(CanvasDoc.Empty) };
        var (orchestrator, store, _) = Build(bridge);
        store.SetDoc(DocWithElement("e1", Dragged));

        var removed = await orchestrator.RemoveLayerAndRefreshAsync("c1");

        Assert.True(removed.Ok);
        bridge.GetCanvas = () => Task.FromResult(DocWithElement("e2", new Position(0, 0)));
        bridge.RunRecipe = _ => Task.FromResult(new RecipeRunResult(true, new Dictionary<string, string> { ["temp1"] = "e2" }, Array.Empty<string>()));
        var added = await orchestrator.RunRecipeAndLayoutAsync("c1");

        Assert.True(added.Ok);
        var ops = bridge.Patches[^1].Ops;
        Assert.Equal(new[] { new CanvasOp("update_element", "e2", Dragged, null) }, ops.ToArray());
    }

    [Fact]
    public async Task Without_a_captured_position_the_run_falls_back_to_auto_layout()
    {
        var bridge = new FakeBridge
        {
            RunRecipe = _ => Task.FromResult(new RecipeRunResult(true, new Dictionary<string, string> { ["temp1"] = "e1" }, Array.Empty<string>())),
            GetCanvas = () => Task.FromResult(DocWithElement("e1", new Position(0, 0))),
        };
        var (orchestrator, _, _) = Build(bridge);

        var added = await orchestrator.RunRecipeAndLayoutAsync("c1");

        Assert.True(added.Ok);
        Assert.NotEqual(Dragged, bridge.Patches[^1].Ops[0].Position);
    }

    [Fact]
    public async Task A_fresh_draw_ends_with_the_laid_out_doc_and_never_the_origin_pile()
    {
        var calls = 0;
        var bridge = new FakeBridge
        {
            RunRecipe = _ => Task.FromResult(new RecipeRunResult(true, new Dictionary<string, string> { ["t1"] = "e1", ["t2"] = "e2" }, Array.Empty<string>())),
            GetCanvas = () =>
            {
                calls++;
                var atOrigin = calls == 1;
                return Task.FromResult(Fx.DocOf(
                    Fx.Element("e1", x: atOrigin ? 0 : 100, y: atOrigin ? 0 : 120, meta: new Dictionary<string, object?> { ["recipe_key"] = "n1" }),
                    Fx.Element("e2", x: atOrigin ? 0 : 460, y: atOrigin ? 0 : 120, meta: new Dictionary<string, object?> { ["recipe_key"] = "n2" })));
            },
        };
        var (orchestrator, store, _) = Build(bridge);

        var added = await orchestrator.RunRecipeAndLayoutAsync("c1");

        Assert.True(added.Ok);
        Assert.Single(bridge.Patches);
        Assert.Equal(2, bridge.Patches[0].Ops.Count);
        Assert.Equal(new Position(100, 120), store.Doc.Elements["e1"].Position);
        Assert.Equal(new Position(460, 120), store.Doc.Elements["e2"].Position);
        Assert.Empty(store.LayersMidLayout());
    }

    [Fact]
    public async Task An_out_of_band_refetch_that_still_shows_a_deferred_layer_piled_at_the_origin_is_withheld()
    {
        var bridge = new FakeBridge
        {
            GetCanvas = () => Task.FromResult(Fx.DocOf(Fx.Element("e1", meta: new Dictionary<string, object?> { ["recipe_key"] = "n1" }))),
        };
        var (orchestrator, store, _) = Build(bridge);
        store.SetDoc(Fx.DocOf(Fx.Element("e0", x: 30, y: 40)));

        store.DeferLayout("c1");
        await store.PatchAsync(bridge, new[] { new CanvasOp("update_element", "e0", new Position(30, 40), null) });
        store.ReleaseLayout("c1");

        Assert.Equal(new Position(30, 40), store.Doc.Elements["e0"].Position);
        Assert.False(store.Doc.Elements.ContainsKey("e1"));
        _ = orchestrator;
    }

    [Fact]
    public async Task A_failed_recipe_reports_the_first_error_and_releases_the_deferred_layer()
    {
        var bridge = new FakeBridge { RunRecipe = _ => Task.FromResult(new RecipeRunResult(false, new Dictionary<string, string>(), new[] { "recipe boom" })) };
        var (orchestrator, store, _) = Build(bridge);

        var result = await orchestrator.RunRecipeAndLayoutAsync("c1");

        Assert.Equal(new OpResult(false, "recipe boom"), result);
        Assert.Empty(store.LayersMidLayout());
    }

    [Fact]
    public async Task Delete_removes_the_file_first_then_the_layer_from_the_canvas()
    {
        var bridge = new FakeBridge();
        var (orchestrator, store, _) = Build(bridge);
        store.SetDoc(DocWithElement("e1", Dragged, "system-context"));

        var result = await orchestrator.DeleteDiagramAndRefreshAsync("system-context");

        Assert.True(result.Ok);
        Assert.Equal(new[] { "delete:system-context", "patch", "getCanvas" }, bridge.Calls.ToArray());
    }

    [Fact]
    public async Task A_failed_file_delete_leaves_the_canvas_untouched()
    {
        var bridge = new FakeBridge { DeleteDiagram = _ => throw new InvalidOperationException("disk error") };
        var (orchestrator, store, _) = Build(bridge);
        store.SetDoc(DocWithElement("e1", Dragged, "system-context"));

        var result = await orchestrator.DeleteDiagramAndRefreshAsync("system-context");

        Assert.Equal(new OpResult(false, "disk error"), result);
        Assert.Empty(bridge.Patches);
    }

    [Fact]
    public async Task A_freeform_layer_with_no_backing_recipe_skips_the_file_delete()
    {
        var bridge = new FakeBridge();
        var (orchestrator, store, _) = Build(bridge);
        store.SetDoc(CanvasDoc.Empty);

        var result = await orchestrator.DeleteDiagramAndRefreshAsync("auth-lens");

        Assert.True(result.Ok);
        Assert.DoesNotContain("delete:auth-lens", bridge.Calls);
    }

    [Fact]
    public async Task Removing_a_layer_deletes_its_elements_and_stray_edges_with_mass_delete_confirmed()
    {
        var doc = Fx.DocOf(Fx.Element("a"), Fx.Element("b"), Fx.Element("other", layer: "patterns")) with
        {
            Edges = new Dictionary<string, CanvasEdge>
            {
                ["stray"] = new() { Id = "stray", From = "x", To = "y", Layer = "c1", Kind = "uses" },
                ["kept"] = new() { Id = "kept", From = "other", To = "other", Layer = "patterns", Kind = "uses" },
            },
        };
        var bridge = new FakeBridge();
        var (orchestrator, store, _) = Build(bridge);
        store.SetDoc(doc);

        await orchestrator.RemoveLayerAndRefreshAsync("c1");

        var batch = bridge.Patches.Single();
        Assert.True(batch.ConfirmMassDelete);
        Assert.Equal("c1", batch.Layer);
        Assert.Equal(
            new[] { ("delete_element", "a"), ("delete_element", "b"), ("delete_edge", "stray") },
            batch.Ops.Select(o => (o.Op, o.Id!)).ToArray());
    }

    [Fact]
    public async Task Removing_a_layer_clears_its_health_note()
    {
        var bridge = new FakeBridge();
        var store = new CanvasDocStore();
        var health = new DiagramHealthStore();
        health.Set("c1", new[] { "note" });
        var orchestrator = new DiagramOrchestrator(bridge, store, new LayerPositionCache(), health);
        store.SetDoc(DocWithElement("e1", Dragged));

        await orchestrator.RemoveLayerAndRefreshAsync("c1");

        Assert.Empty(health.Get("c1"));
    }
}
