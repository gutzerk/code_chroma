namespace CodeChroma.Canvas.Tests.State;

public class CanvasDocStoreTests
{
    private static CanvasDoc DocWithLabel(string label) =>
        Fx.DocOf(Fx.Element("a", label: label));

    [Fact]
    public async Task A_slower_stale_response_never_overwrites_a_newer_one_that_already_applied()
    {
        var responses = new[] { new TaskCompletionSource<CanvasDoc>(), new TaskCompletionSource<CanvasDoc>() };
        var call = 0;
        var bridge = new FakeBridge { GetCanvas = () => responses[call++].Task };
        var store = new CanvasDocStore();

        var mount = store.FetchAndApplyAsync(bridge);
        var ping = store.FetchAndApplyAsync(bridge);
        responses[1].SetResult(DocWithLabel("second"));
        await ping;
        responses[0].SetResult(DocWithLabel("first"));
        await mount;

        Assert.Equal("second", store.Doc.Elements["a"].Label);
    }

    [Fact]
    public async Task The_refetch_a_patch_issues_wins_even_over_a_slower_concurrent_refetch_issued_just_before()
    {
        var changedPing = new TaskCompletionSource<CanvasDoc>();
        var patchRefetch = new TaskCompletionSource<CanvasDoc>();
        var call = 0;
        var bridge = new FakeBridge { GetCanvas = () => (call++ == 0 ? changedPing : patchRefetch).Task };
        var store = new CanvasDocStore();

        var ping = store.FetchAndApplyAsync(bridge);
        var commit = store.PatchAsync(bridge, Array.Empty<CanvasOp>());
        patchRefetch.SetResult(DocWithLabel("patched"));
        await commit;
        changedPing.SetResult(DocWithLabel("stale-changed-ping"));
        await ping;

        Assert.Equal("patched", store.Doc.Elements["a"].Label);
    }

    [Fact]
    public async Task A_fetch_whose_caller_has_gone_stale_is_not_applied()
    {
        var bridge = new FakeBridge { GetCanvas = () => Task.FromResult(DocWithLabel("late")) };
        var store = new CanvasDocStore();

        await store.FetchAndApplyAsync(bridge, isStale: () => true);

        Assert.False(store.Loaded);
    }

    [Fact]
    public void ReleaseLayout_drops_only_its_own_layer_keeping_a_concurrent_one_withheld()
    {
        var store = new CanvasDocStore();
        store.DeferLayout("epics");
        store.DeferLayout("c1");

        store.ReleaseLayout("epics");

        Assert.Equal(new[] { "c1" }, store.LayersMidLayout().ToArray());
    }

    [Fact]
    public void Releasing_a_layer_that_was_never_deferred_is_a_no_op()
    {
        var store = new CanvasDocStore();
        store.DeferLayout("c1");

        store.ReleaseLayout("epics");
        store.ReleaseLayout("c1");

        Assert.Empty(store.LayersMidLayout());
    }

    [Fact]
    public void MoveElements_settles_every_position_with_exactly_one_change_notification()
    {
        var store = new CanvasDocStore();
        store.SetDoc(Fx.DocOf(Fx.Element("a"), Fx.Element("b"), Fx.Element("c")));
        var changes = 0;
        store.Changed += () => changes++;

        store.MoveElements(new Dictionary<string, Position> { ["a"] = new(1, 1), ["b"] = new(2, 2), ["missing"] = new(9, 9) });

        Assert.Equal(1, changes);
        Assert.Equal(new Position(1, 1), store.Doc.Elements["a"].Position);
        Assert.Equal(new Position(0, 0), store.Doc.Elements["c"].Position);
    }

    [Fact]
    public void Moving_only_unknown_ids_does_not_notify()
    {
        var store = new CanvasDocStore();
        var changes = 0;
        store.Changed += () => changes++;

        store.MoveElements(new Dictionary<string, Position> { ["missing"] = new(9, 9) });

        Assert.Equal(0, changes);
    }

    [Fact]
    public async Task A_position_commit_settles_optimistically_then_persists_one_update_per_id()
    {
        var bridge = new FakeBridge { GetCanvas = () => Task.FromResult(Fx.DocOf(Fx.Element("a", x: 50, y: 60))) };
        var store = new CanvasDocStore();
        store.SetDoc(Fx.DocOf(Fx.Element("a")));

        await store.ApplyCanvasPositionsAsync(bridge, new Dictionary<string, Position> { ["a"] = new(50, 60) });

        Assert.Equal(new[] { new CanvasOp("update_element", "a", new Position(50, 60), null) }, bridge.Patches.Single().Ops.ToArray());
        Assert.Equal(new Position(50, 60), store.Doc.Elements["a"].Position);
    }

    [Fact]
    public async Task A_rejected_position_write_rolls_back_to_the_pre_drag_positions()
    {
        var bridge = new FakeBridge { Patch = _ => Task.FromResult(new BatchResult(false, new[] { "rejected" })) };
        var store = new CanvasDocStore();
        store.SetDoc(Fx.DocOf(Fx.Element("a", x: 5, y: 6)));

        await store.ApplyCanvasPositionsAsync(bridge, new Dictionary<string, Position> { ["a"] = new(50, 60) });

        Assert.Equal(new Position(5, 6), store.Doc.Elements["a"].Position);
    }

    [Fact]
    public async Task A_thrown_position_write_also_rolls_back()
    {
        var bridge = new FakeBridge { Patch = _ => throw new IOException("offline") };
        var store = new CanvasDocStore();
        store.SetDoc(Fx.DocOf(Fx.Element("a", x: 5, y: 6)));

        await store.ApplyCanvasPositionsAsync(bridge, new Dictionary<string, Position> { ["a"] = new(50, 60) });

        Assert.Equal(new Position(5, 6), store.Doc.Elements["a"].Position);
    }

    [Fact]
    public async Task A_snapshot_with_a_whole_layer_piled_on_the_origin_is_laid_out_and_persisted_instead_of_shown()
    {
        var piled = Fx.DocOf(Fx.Element("a", layer: "x", render: RenderKind.Custom), Fx.Element("b", layer: "x", render: RenderKind.Custom));
        var bridge = new FakeBridge { GetCanvas = () => Task.FromResult(piled) };
        var store = new CanvasDocStore();

        await store.FetchAndApplyAsync(bridge);

        var batch = bridge.Patches.Single();
        Assert.Equal("x", batch.Layer);
        Assert.Equal("auto-layout unplaced boxes", batch.Explanation);
        Assert.Equal(new[] { "a", "b" }, batch.Ops.Select(o => o.Id!).OrderBy(x => x).ToArray());
        Assert.Contains("a", store.AutoPlacedIds);
        Assert.Empty(store.LayersMidLayout());
    }

    [Fact]
    public async Task A_layout_that_throws_marks_the_layer_unlayoutable_and_shows_the_snapshot_once()
    {
        var piled = Fx.DocOf(Fx.Element("a", layer: "x", render: RenderKind.Custom), Fx.Element("b", layer: "x", render: RenderKind.Custom));
        var bridge = new FakeBridge { GetCanvas = () => Task.FromResult(piled), Patch = _ => throw new IOException("offline") };
        var store = new CanvasDocStore();

        await store.FetchAndApplyAsync(bridge);

        Assert.Contains("x", store.UnlayoutableLayers);
        Assert.Equal(2, store.Doc.Elements.Count);
        Assert.Empty(store.LayersMidLayout());
    }
}
