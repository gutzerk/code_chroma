using CodeChroma.Canvas.Hierarchy;

namespace CodeChroma.Canvas.Tests.Hierarchy;

/// <summary>An in-memory hierarchy: root -> A.. -> children, built from (id, parent) pairs.</summary>
internal sealed class TableSource : IHierarchySource
{
    private readonly Dictionary<string, HierarchyItem> _items = new();
    private readonly Dictionary<string, List<HierarchyItem>> _kids = new();

    public TableSource Add(string id, string? parent, string level = "component", string? description = null, string? name = null)
    {
        var item = new HierarchyItem(id, name ?? id, level, parent ?? HierarchyIds.Root, false, description);
        _items[id] = item;
        if (!_kids.TryGetValue(item.ParentId!, out var list)) _kids[item.ParentId!] = list = new();
        list.Add(item);
        if (_items.TryGetValue(item.ParentId!, out var p) && !p.HasChildren) _items[p.Id] = p with { HasChildren = true };
        return this;
    }

    public TableSource Finish()
    {
        foreach (var key in _kids.Keys.ToList())
            _kids[key] = _kids[key].Select(i => _items[i.Id] with { HasChildren = _kids.ContainsKey(i.Id) }).ToList();
        foreach (var id in _items.Keys.ToList()) _items[id] = _items[id] with { HasChildren = _kids.ContainsKey(id) };
        return this;
    }

    public HierarchyItem? Get(string id) =>
        id == HierarchyIds.Root ? new HierarchyItem(HierarchyIds.Root, "root", "root", null, _kids.ContainsKey(HierarchyIds.Root)) : _items.GetValueOrDefault(id);

    public IReadOnlyList<HierarchyItem> Children(string id) => _kids.TryGetValue(id, out var l) ? l : [];

    /// <summary>root -> sys -> (a, b) -> a has a1, a2; a1 has a1x.</summary>
    public static TableSource Tree() => new TableSource()
        .Add("sys", null, "system")
        .Add("a", "sys", "pillar").Add("b", "sys", "pillar")
        .Add("a1", "a").Add("a2", "a").Add("a1x", "a1", "function")
        .Finish();

    public static TableSource Flat(int systems, int childrenOfFirst = 0)
    {
        var t = new TableSource();
        for (var i = 0; i < systems; i++) t.Add($"s{i}", null, "system");
        for (var i = 0; i < childrenOfFirst; i++) t.Add($"c{i}", "s0");
        return t.Finish();
    }
}

public class ExpansionStateTests
{
    private sealed class MemoryStorage : IKeyValueStore
    {
        public Dictionary<string, string> Data { get; } = new();
        public string? Get(string key) => Data.GetValueOrDefault(key);
        public void Set(string key, string value) => Data[key] = value;
    }

    [Fact]
    public void Siblings_and_depths_expand_independently_and_in_order()
    {
        var state = new ExpansionState(TableSource.Tree());

        state.Expand("sys");
        state.Expand("a");
        state.Expand("b");
        state.Collapse("b");

        Assert.Equal(new[] { "sys", "a" }, state.ExpandedOrder);
        Assert.True(state.IsExpanded("a"));
        Assert.False(state.IsExpanded("b"));
    }

    [Fact]
    public void Toggle_flips_the_state_and_expanding_twice_is_a_no_op()
    {
        var state = new ExpansionState(TableSource.Tree());
        var changes = 0;
        state.Changed += () => changes++;

        state.Toggle("sys");
        state.Expand("sys");
        state.Toggle("sys");

        Assert.False(state.IsExpanded("sys"));
        Assert.Equal(2, changes);
    }

    [Fact]
    public void Collapsing_an_ancestor_collapses_every_open_descendant_and_hides_their_code()
    {
        var state = new ExpansionState(TableSource.Tree());
        state.Expand("sys"); state.Expand("a"); state.Expand("a1"); state.ShowCode("a1x");

        state.Collapse("sys");

        Assert.Empty(state.ExpandedOrder);
        Assert.True(state.IsCodeVisible("a1x"));
        state.Expand("a1");
        state.ShowCode("a1");
        state.Collapse("a1");
        Assert.False(state.IsCodeVisible("a1"));
    }

    [Fact]
    public void The_deepest_expanded_path_runs_from_the_root_down_to_the_latest_open_block()
    {
        var state = new ExpansionState(TableSource.Tree());
        state.Expand("sys"); state.Expand("a"); state.Expand("a1");

        var path = state.DeepestExpandedPath();

        Assert.Equal(new[] { "root", "sys", "a", "a1" }, path);
    }

    [Theory]
    [InlineData("a1x", "sys", false)]
    [InlineData("a1x", "a1", true)]
    public void The_nearest_visible_ancestor_stops_at_the_first_closed_block(string id, string open, bool deep)
    {
        var state = new ExpansionState(TableSource.Tree());
        state.Expand("sys"); state.Expand("a");
        if (deep) state.Expand("a1");

        var visible = state.NearestVisibleAncestor(id);

        Assert.Equal(deep ? "a1x" : "a1", visible);
    }

    [Fact]
    public void A_persisted_snapshot_restores_per_workspace_and_marks_the_tree_restored()
    {
        var storage = new MemoryStorage();
        var first = new ExpansionState(TableSource.Tree(), storage, () => "w1");
        Assert.False(first.Restored);
        first.Expand("sys"); first.ShowCode("a1x");

        var again = new ExpansionState(TableSource.Tree(), storage, () => "w1");
        var other = new ExpansionState(TableSource.Tree(), storage, () => "w2");

        Assert.True(again.Restored);
        Assert.Equal(new[] { "sys" }, again.ExpandedOrder);
        Assert.True(again.IsCodeVisible("a1x"));
        Assert.False(other.Restored);
        Assert.Empty(other.ExpandedOrder);
    }

    [Fact]
    public void Unreadable_storage_restores_nothing_and_never_throws()
    {
        var storage = new MemoryStorage();
        storage.Data["codechroma.expansion.default"] = "{not json";

        var state = new ExpansionState(TableSource.Tree(), storage);

        Assert.False(state.Restored);
    }
}

internal sealed class FixedMeasurer : ITextMeasurer
{
    public double LineHeight => 16;
    public TextSize Measure(string text, double maxWidth, double fontSize) => new(maxWidth, 48);
}

public class HierarchyLayoutTests
{
    public static IEnumerable<object[]> ChildLayouts => Fx.Cases("hierarchy_layout.json", "childLayout");
    public static IEnumerable<object[]> TopGrids => Fx.Cases("hierarchy_layout.json", "topLevelGrid");

    [Fact]
    public void A_collapsed_block_is_a_minimum_sized_card_and_shows_no_children()
    {
        var source = TableSource.Tree();

        var scene = HierarchyLayout.Compute(source, new ExpansionState(source));

        var only = Assert.Single(scene.Boxes);
        Assert.Equal(HierarchyLayout.MinWidth, only.Rect.Width);
        Assert.Equal(HierarchyLayout.MinHeight, only.Rect.Height);
        Assert.False(only.Expanded);
    }

    [Fact]
    public void Expanding_reveals_children_in_place_inside_the_parent_without_moving_the_top_left()
    {
        var source = TableSource.Tree();
        var expansion = new ExpansionState(source);
        var before = HierarchyLayout.Compute(source, expansion).Find("sys")!;

        expansion.Expand("sys");
        var scene = HierarchyLayout.Compute(source, expansion);

        var after = scene.Find("sys")!;
        Assert.Equal(before.Rect.Left, after.Rect.Left);
        Assert.Equal(before.Rect.Top, after.Rect.Top);
        Assert.True(after.Rect.Height > before.Rect.Height);
        Assert.All(scene.ChildrenOf("sys"), c => Assert.True(Contains(after.Rect, c.Rect), $"{c.Id} {c.Rect} outside {after.Rect}"));
    }

    [Fact]
    public void Several_siblings_and_depths_stay_open_at_once_down_to_a_leaf()
    {
        var source = TableSource.Tree();
        var expansion = new ExpansionState(source);
        expansion.Expand("sys"); expansion.Expand("a"); expansion.Expand("a1");

        var scene = HierarchyLayout.Compute(source, expansion);

        Assert.Equal(new[] { "sys", "a", "a1", "a1x", "a2", "b" }.OrderBy(x => x), scene.Boxes.Select(b => b.Id).OrderBy(x => x));
        Assert.Equal(new[] { 0, 1, 2, 3 }, new[] { "sys", "a", "a1", "a1x" }.Select(id => scene.Find(id)!.Depth));
        Assert.All(scene.Boxes.Where(b => b.ParentBoxId is not null), b => Assert.True(Contains(scene.Find(b.ParentBoxId!)!.Rect, b.Rect)));
    }

    [Fact]
    public void Collapsing_one_block_leaves_its_parent_open()
    {
        var source = TableSource.Tree();
        var expansion = new ExpansionState(source);
        expansion.Expand("sys"); expansion.Expand("a");

        expansion.Collapse("a");
        var scene = HierarchyLayout.Compute(source, expansion);

        Assert.True(scene.Find("sys")!.Expanded);
        Assert.Null(scene.Find("a1"));
        Assert.NotNull(scene.Find("a"));
    }

    [Theory, MemberData(nameof(ChildLayouts))]
    public void Children_wrap_in_a_row_up_to_five_then_stack_in_one_column(string name, string json)
    {
        var c = Fx.Parse(json);
        var source = TableSource.Flat(1, c.GetProperty("childCount").GetInt32());
        var expansion = new ExpansionState(source);
        expansion.Expand("s0");

        var kids = HierarchyLayout.Compute(source, expansion).ChildrenOf("s0");

        Assert.Equal(c.GetProperty("columns").GetInt32(), kids.Select(k => k.Rect.Left).Distinct().Count());
        Assert.Equal(c.GetProperty("rows").GetInt32(), kids.Select(k => k.Rect.Top).Distinct().Count());
    }

    [Theory, MemberData(nameof(TopGrids))]
    public void Top_level_systems_sit_on_a_wrapped_grid(string name, string json)
    {
        var c = Fx.Parse(json);
        var source = TableSource.Flat(c.GetProperty("count").GetInt32());

        var tops = HierarchyLayout.Compute(source, new ExpansionState(source)).TopLevel.ToList();

        Assert.Equal(new Point(0, 0), new Point(tops[0].Rect.Left, tops[0].Rect.Top));
        Assert.Equal(c.GetProperty("columns").GetInt32(), tops.Select(t => t.Rect.Left).Distinct().Count());
    }

    [Fact]
    public void A_dragged_top_level_position_overrides_its_grid_cell_for_that_box_only()
    {
        var source = TableSource.Flat(2);
        var saved = new Dictionary<string, Position> { ["s1"] = new Position(900, 500) };

        var scene = HierarchyLayout.Compute(source, new ExpansionState(source), null, saved);

        Assert.Equal(new Point(900, 500), new Point(scene.Find("s1")!.Rect.Left, scene.Find("s1")!.Rect.Top));
        Assert.Equal(0, scene.Find("s0")!.Rect.Left);
    }

    [Fact]
    public void An_open_description_makes_the_header_taller_and_a_closed_one_does_not()
    {
        var source = new TableSource().Add("s", null, "system", "what this system does").Add("c", "s").Finish();
        var expansion = new ExpansionState(source);
        var measurer = new FixedMeasurer();
        var closed = HierarchyLayout.Compute(source, expansion, measurer).Find("s")!.HeaderHeight;

        expansion.Expand("s");
        var open = HierarchyLayout.Compute(source, expansion, measurer).Find("s")!.HeaderHeight;

        Assert.True(open > closed);
    }

    [Fact]
    public void Showing_code_replaces_the_children_with_a_code_panel()
    {
        var source = TableSource.Tree();
        var expansion = new ExpansionState(source);
        expansion.Expand("sys"); expansion.Expand("a");

        expansion.ShowCode("a");
        var scene = HierarchyLayout.Compute(source, expansion);

        Assert.Null(scene.Find("a1"));
        Assert.True(scene.Find("a")!.CodeOpen);
        Assert.True(scene.Find("a")!.Rect.Height >= HierarchyLayout.CodePanelHeight);
    }

    [Fact]
    public void Hit_testing_returns_the_deepest_box_under_the_point()
    {
        var source = TableSource.Tree();
        var expansion = new ExpansionState(source);
        expansion.Expand("sys");
        var scene = HierarchyLayout.Compute(source, expansion);
        var a = scene.Find("a")!.Rect;

        var hit = scene.HitTest(new Point(a.CenterX, a.CenterY));

        Assert.Equal("a", hit!.Id);
        Assert.Null(scene.HitTest(new Point(-500, -500)));
    }

    private static bool Contains(Rect outer, Rect inner) =>
        inner.Left >= outer.Left && inner.Top >= outer.Top && inner.Right <= outer.Right + 1e-6 && inner.Bottom <= outer.Bottom + 1e-6;
}
