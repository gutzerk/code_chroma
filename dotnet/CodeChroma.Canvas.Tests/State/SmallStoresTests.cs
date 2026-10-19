namespace CodeChroma.Canvas.Tests.State;

public class CollapsedLayersStoreTests
{
    private static (CollapsedLayersStore Store, MemoryKeyValueStore Storage, WorkspaceStoreRegistry Registry, ActiveWorkspace Active) Build(string initial = "main")
    {
        var storage = new MemoryKeyValueStore();
        var registry = new WorkspaceStoreRegistry();
        var active = new ActiveWorkspace(initial);
        return (new CollapsedLayersStore(storage, () => active.Id, registry), storage, registry, active);
    }

    [Fact]
    public void Starts_with_nothing_collapsed()
    {
        var (store, _, _, _) = Build();

        Assert.False(store.IsCollapsed("c1"));
        Assert.Empty(store.Collapsed);
    }

    [Fact]
    public void Toggle_collapses_then_expands_a_layer()
    {
        var (store, _, _, _) = Build();

        store.Toggle("c1");
        var collapsed = store.IsCollapsed("c1");
        store.Toggle("c1");

        Assert.True(collapsed);
        Assert.False(store.IsCollapsed("c1"));
    }

    [Fact]
    public void A_no_op_collapse_or_expand_does_not_notify()
    {
        var (store, _, _, _) = Build();
        var changes = 0;
        store.Changed += () => changes++;

        store.Expand("c1");
        store.Collapse("c1");
        store.Collapse("c1");

        Assert.Equal(1, changes);
    }

    [Fact]
    public void Participates_in_a_workspace_reset()
    {
        var (store, _, registry, _) = Build();
        store.Collapse("c1");

        registry.ResetAll();

        Assert.False(store.IsCollapsed("c1"));
    }

    [Fact]
    public void A_collapsed_layer_persists_and_is_restored_after_a_reload()
    {
        var (store, _, _, _) = Build();
        store.Collapse("epics");

        store.Reset();
        store.Load();

        Assert.True(store.IsCollapsed("epics"));
    }

    [Fact]
    public void A_later_collapse_of_another_layer_does_not_clobber_a_restored_one()
    {
        var (store, storage, _, _) = Build();
        storage.Set("codechroma.collapsedLayers.main", """["epics"]""");

        store.Load();
        store.Collapse("hierarchy");

        Assert.True(store.IsCollapsed("epics"));
        Assert.True(store.IsCollapsed("hierarchy"));
        Assert.Equal(new[] { "epics", "hierarchy" }, JsonSerializer.Deserialize<string[]>(storage.Get("codechroma.collapsedLayers.main")!)!.OrderBy(x => x).ToArray());
    }

    [Fact]
    public void Storage_is_keyed_to_the_active_workspace_and_tolerates_corrupt_values()
    {
        var (store, storage, _, active) = Build();
        storage.Set("codechroma.collapsedLayers.main", "{not json");
        storage.Set("codechroma.collapsedLayers.agent-1", """["c1"]""");

        active.Id = "agent-1";
        store.Load();
        var onAgent = store.IsCollapsed("c1");
        active.Id = "main";
        store.Load();

        Assert.True(onAgent);
        Assert.Empty(store.Collapsed);
    }

    [Fact]
    public void A_failing_write_never_breaks_the_toggle()
    {
        var store = new CollapsedLayersStore(new ThrowingKeyValueStore(), () => "main", new WorkspaceStoreRegistry());

        store.Collapse("c1");

        Assert.True(store.IsCollapsed("c1"));
    }
}

public class DragOffsetStoreTests
{
    [Fact]
    public void SetMany_merges_every_entry_and_notifies_exactly_once()
    {
        var store = new DragOffsetStore();
        var notifications = 0;
        store.Changed += () => notifications++;

        store.SetMany(new Dictionary<string, LiveDragOffset> { ["a"] = new(1, 1), ["b"] = new(2, 2), ["c"] = new(3, 3) });

        Assert.Equal(1, notifications);
        Assert.Equal(3, store.All.Count);
    }

    [Fact]
    public void SetMany_overwrites_only_the_ids_it_is_given()
    {
        var store = new DragOffsetStore();
        store.Set("existing", new LiveDragOffset(0, 0));
        store.Set("kept", new LiveDragOffset(7, 7));

        store.SetMany(new Dictionary<string, LiveDragOffset> { ["existing"] = new(5, 5), ["fresh"] = new(9, 9) });

        Assert.Equal(new LiveDragOffset(5, 5), store.All["existing"]);
        Assert.Equal(new LiveDragOffset(9, 9), store.All["fresh"]);
        Assert.Equal(new LiveDragOffset(7, 7), store.All["kept"]);
    }

    [Fact]
    public void SetMany_with_no_entries_never_notifies()
    {
        var store = new DragOffsetStore();
        var notifications = 0;
        store.Changed += () => notifications++;

        store.SetMany(new Dictionary<string, LiveDragOffset>());

        Assert.Equal(0, notifications);
    }

    [Fact]
    public void Setting_the_same_value_again_is_not_a_broadcast()
    {
        var store = new DragOffsetStore();
        store.Set("a", new LiveDragOffset(1, 1));
        var notifications = 0;
        store.Changed += () => notifications++;

        store.Set("a", new LiveDragOffset(1, 1));
        store.Clear("not-there");

        Assert.Equal(0, notifications);
    }
}

public class LayerPositionCacheTests
{
    private static CanvasElement Keyed(string id, string key, double x, double y) =>
        Fx.Element(id, x: x, y: y, meta: new Dictionary<string, object?> { ["recipe_key"] = key });

    [Fact]
    public void A_captured_position_is_returned_once_then_forgotten()
    {
        var cache = new LayerPositionCache();
        cache.Capture(new[] { Keyed("e1", "n1", 540, 320) }, "c1");

        var first = cache.Take("c1", "n1");
        var second = cache.Take("c1", "n1");

        Assert.Equal(new Position(540, 320), first);
        Assert.Null(second);
    }

    [Fact]
    public void Recapturing_a_layer_overwrites_the_earlier_snapshot_and_unkeyed_elements_are_skipped()
    {
        var cache = new LayerPositionCache();
        cache.Capture(new[] { Keyed("e1", "n1", 1, 1) }, "c1");

        cache.Capture(new[] { Keyed("e1", "n1", 2, 2), Fx.Element("unkeyed", x: 9, y: 9) }, "c1");

        Assert.Equal(new Position(2, 2), cache.Take("c1", "n1"));
        Assert.Null(cache.Take("c1", "unkeyed"));
    }

    [Fact]
    public void Seeded_positions_are_served_like_captured_ones()
    {
        var cache = new LayerPositionCache();
        cache.Seed("c1", new Dictionary<string, Position> { ["n1"] = new(3, 4) });

        Assert.Equal(new Position(3, 4), cache.Take("c1", "n1"));
    }
}

public class DiagramStatusCacheTests
{
    [Fact]
    public void A_status_map_round_trips_through_storage()
    {
        var cache = new DiagramStatusCache(new MemoryKeyValueStore());
        var status = new DiagramsStatus(new Dictionary<string, DiagramStatusEntry> { ["c1"] = new(true, "abc") });

        cache.Write(status);

        Assert.Equal(status.Entries["c1"], cache.Read()!.Entries["c1"]);
    }

    [Fact]
    public void Nothing_cached_yields_null()
    {
        Assert.Null(new DiagramStatusCache(new MemoryKeyValueStore()).Read());
    }

    [Fact]
    public void Corrupt_json_yields_null_instead_of_throwing()
    {
        var storage = new MemoryKeyValueStore();
        storage.Set("codechroma.diagramsStatusCache", "{not json");

        Assert.Null(new DiagramStatusCache(storage).Read());
    }

    [Fact]
    public void A_write_failure_is_swallowed()
    {
        var cache = new DiagramStatusCache(new ThrowingKeyValueStore());

        var ex = Record.Exception(() => cache.Write(new DiagramsStatus(new Dictionary<string, DiagramStatusEntry>())));

        Assert.Null(ex);
    }
}

public class DiagramStatusPlannerTests
{
    private static DiagramsStatus Status(params (string Kind, bool Ready, string? Fp)[] entries) =>
        new(entries.ToDictionary(e => e.Kind, e => new DiagramStatusEntry(e.Ready, e.Fp)));

    [Fact]
    public void A_first_ever_visit_has_no_baseline_so_nothing_arrives_or_goes_stale()
    {
        var plan = DiagramStatusPlanner.Plan(null, Status(("c1", true, "fp")), new HashSet<string>());

        Assert.Empty(plan.Arrived);
        Assert.Empty(plan.Stale);
    }

    [Fact]
    public void A_diagram_that_just_became_ready_and_is_not_placed_arrives()
    {
        var plan = DiagramStatusPlanner.Plan(Status(("c1", false, null)), Status(("c1", true, "fp")), new HashSet<string>());

        Assert.Equal(new[] { "c1" }, plan.Arrived.ToArray());
    }

    [Fact]
    public void A_placed_diagram_whose_fingerprint_changed_since_the_last_visit_is_stale()
    {
        var plan = DiagramStatusPlanner.Plan(Status(("c1", true, "fp-old")), Status(("c1", true, "fp-new")), new HashSet<string> { "c1" });

        Assert.Equal(new[] { "c1" }, plan.Stale.ToArray());
        Assert.Empty(plan.Arrived);
    }

    [Fact]
    public void An_unchanged_fingerprint_does_not_re_run_the_recipe()
    {
        var plan = DiagramStatusPlanner.Plan(Status(("c1", true, "fp-same")), Status(("c1", true, "fp-same")), new HashSet<string> { "c1" });

        Assert.Empty(plan.Stale);
    }

    [Fact]
    public void A_missing_fingerprint_on_either_side_is_never_stale()
    {
        var plan = DiagramStatusPlanner.Plan(Status(("c1", true, null)), Status(("c1", true, "fp")), new HashSet<string> { "c1" });

        Assert.Empty(plan.Stale);
    }
}

internal sealed class MemoryKeyValueStore : IKeyValueStore
{
    private readonly Dictionary<string, string> _values = new();
    public string? Get(string key) => _values.TryGetValue(key, out var v) ? v : null;
    public void Set(string key, string value) => _values[key] = value;
}

internal sealed class ActiveWorkspace
{
    public ActiveWorkspace(string id) => Id = id;
    public string Id { get; set; }
}

internal sealed class ThrowingKeyValueStore : IKeyValueStore
{
    public string? Get(string key) => throw new IOException("unavailable");
    public void Set(string key, string value) => throw new IOException("quota exceeded");
}
