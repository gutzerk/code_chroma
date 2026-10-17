namespace CodeChroma.Canvas.Tests.State;

/// <summary>selectionStore.test.ts, undoStore.test.ts and the marquee/UndoManager rules as pure logic.</summary>
public class SelectionModelTests
{
    [Fact]
    public void Toggle_adds_then_removes_leaving_the_rest()
    {
        var s = new SelectionModel();
        s.Replace(new[] { "a", "b" });

        s.Toggle("c");
        s.Toggle("a");

        Assert.Equal(new[] { "b", "c" }, s.Ids);
    }

    [Fact]
    public void Replace_with_the_same_set_and_clear_on_empty_do_not_notify()
    {
        var s = new SelectionModel();
        var changes = 0;
        s.Changed += () => changes++;

        s.Clear();
        s.Replace(new[] { "a", "b" });
        s.Replace(new[] { "b", "a" });
        s.AddMany(new[] { "a" });

        Assert.Equal(1, changes);
    }

    [Fact]
    public void AddMany_unions_and_clear_empties()
    {
        var s = new SelectionModel();
        s.Replace(new[] { "a" });

        s.AddMany(new[] { "b", "c" });
        var all = s.Ids.ToArray();
        s.Clear();

        Assert.Equal(new[] { "a", "b", "c" }, all);
        Assert.Equal(0, s.Count);
    }

    [Fact]
    public void Prune_drops_ids_that_no_longer_exist()
    {
        var s = new SelectionModel();
        s.Replace(new[] { "a", "b" });

        s.Prune(id => id == "a");

        Assert.Equal(new[] { "a" }, s.Ids);
    }
}

public class MarqueeTests
{
    [Fact]
    public void Normalize_orders_the_corners_whatever_direction_the_drag_went()
    {
        var r = Marquee.Normalize(new Point(50, 80), new Point(10, 20));

        Assert.Equal(new Rect(10, 20, 40, 60), r);
    }

    [Fact]
    public void Only_rectangles_the_band_touches_are_selected()
    {
        var items = new[] { ("in", new Rect(0, 0, 50, 50)), ("edge", new Rect(90, 0, 50, 50)), ("out", new Rect(300, 300, 10, 10)) };

        var hits = Marquee.Hits(new Rect(10, 10, 100, 100), items);

        Assert.Equal(new[] { "in", "edge" }, hits);
    }
}

public class UndoHistoryTests
{
    private static IReadOnlyDictionary<string, Position> Map(double x) => new Dictionary<string, Position> { ["a"] = new Position(x, x) };

    [Fact]
    public void Undo_pops_the_pre_commit_layout_last_in_first_out_per_kind()
    {
        var h = new UndoHistory();
        h.Record("canvas", Map(1));
        h.Record("canvas", Map(2));
        h.Record("hierarchy", Map(9));

        var second = h.Undo("canvas");
        var first = h.Undo("canvas");

        Assert.Equal(2, second!["a"].X);
        Assert.Equal(1, first!["a"].X);
        Assert.Null(h.Undo("canvas"));
        Assert.True(h.CanUndo("hierarchy"));
    }

    [Fact]
    public void History_is_capped_at_the_limit_dropping_the_oldest()
    {
        var h = new UndoHistory();
        for (var i = 0; i < UndoHistory.Limit + 3; i++) h.Record("canvas", Map(i));

        var popped = Enumerable.Range(0, UndoHistory.Limit + 3).Select(_ => h.Undo("canvas")).Where(m => m is not null).ToList();

        Assert.Equal(UndoHistory.Limit, popped.Count);
        Assert.Equal(UndoHistory.Limit + 2, popped[0]!["a"].X);
        Assert.Equal(3, popped[^1]!["a"].X);
    }

    [Fact]
    public void UndoLatest_pops_whichever_kind_committed_most_recently_and_ignores_unlisted_kinds()
    {
        var h = new UndoHistory();
        h.Record("hierarchy", Map(1));
        h.Record("canvas", Map(2));
        h.Record("other", Map(3));

        var latest = h.UndoLatest(new[] { "hierarchy", "canvas" });

        Assert.Equal("canvas", latest!.Value.Kind);
        Assert.Equal("hierarchy", h.UndoLatest(new[] { "hierarchy", "canvas" })!.Value.Kind);
        Assert.Null(h.UndoLatest(new[] { "hierarchy", "canvas" }));
        Assert.True(h.CanUndo("other"));
    }

    [Fact]
    public void Reset_clears_every_kind_and_notifies_on_record_and_undo()
    {
        var h = new UndoHistory();
        var changes = 0;
        h.Changed += () => changes++;

        h.Record("canvas", Map(1));
        h.Undo("canvas");
        h.Record("canvas", Map(2));
        h.Reset();

        Assert.False(h.CanUndo("canvas"));
        Assert.Equal(4, changes);
    }
}

public class TopLevelLayoutStoreTests
{
    private sealed class MemoryStorage : IKeyValueStore
    {
        public Dictionary<string, string> Data { get; } = new();
        public string? Get(string key) => Data.GetValueOrDefault(key);
        public void Set(string key, string value) => Data[key] = value;
    }

    [Fact]
    public void Dragged_positions_persist_per_workspace_and_come_back_on_load()
    {
        var storage = new MemoryStorage();
        var store = new TopLevelLayoutStore(storage, () => "w1");
        store.Apply(new Dictionary<string, Position> { ["s0"] = new Position(5, 6) });

        var again = new TopLevelLayoutStore(storage, () => "w1");
        var other = new TopLevelLayoutStore(storage, () => "w2");

        Assert.Equal(new Position(5, 6), again.Positions["s0"]);
        Assert.Empty(other.Positions);
    }
}
