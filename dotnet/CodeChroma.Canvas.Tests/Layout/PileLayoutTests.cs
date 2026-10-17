namespace CodeChroma.Canvas.Tests.Layout;

public class PileLayoutTests
{
    public static IEnumerable<object[]> Cases => Fx.Cases("pile_layout.json", "unplaced");

    [Theory, MemberData(nameof(Cases))]
    public void FindUnplaced_returns_the_boxes_still_on_the_origin_per_layer(string name, string json)
    {
        var c = Fx.Parse(json);
        var boxes = c.GetProperty("boxes").EnumerateArray()
            .Select(b => Fx.Element(b[0].GetString()!, layer: b[1].GetString()!, render: RenderKind.Custom, x: b[2].GetDouble(), y: b[3].GetDouble()))
            .ToArray();
        var skip = c.GetProperty("skip").EnumerateArray().Select(s => s.GetString()!).ToHashSet();
        var done = c.GetProperty("done").EnumerateArray().Select(s => s.GetString()!).ToHashSet();

        var unplaced = PileLayout.FindUnplaced(Fx.DocOf(boxes), skip, done);

        var expected = c.GetProperty("expected").EnumerateObject()
            .ToDictionary(p => p.Name, p => p.Value.EnumerateArray().Select(v => v.GetString()!).ToArray());
        Assert.Equal(expected.Keys.OrderBy(k => k), unplaced.Keys.OrderBy(k => k));
        foreach (var (layer, ids) in expected) Assert.Equal(ids, unplaced[layer].ToArray());
    }

    [Fact]
    public void A_locked_layout_layer_is_only_ever_laid_out_whole()
    {
        var doc = Fx.DocOf(
            Fx.Element("a", layer: "epics", render: RenderKind.Epic, x: 5, y: 5),
            Fx.Element("b", layer: "epics", render: RenderKind.Epic));

        var unplaced = PileLayout.FindUnplaced(doc, new HashSet<string>(), new HashSet<string>());

        Assert.Empty(unplaced);
    }

    [Fact]
    public void LayoutOps_carry_the_position_and_the_derived_size_when_there_is_one()
    {
        var positions = new Dictionary<string, Position> { ["a"] = new(1, 2), ["b"] = new(3, 4) };
        var sizes = new Dictionary<string, Size> { ["a"] = new(300, 72) };

        var ops = PileLayout.LayoutOps(positions, sizes);

        Assert.Equal(2, ops.Count);
        Assert.Equal(new CanvasOp("update_element", "a", new Position(1, 2), new Size(300, 72)), ops[0]);
        Assert.Equal(new CanvasOp("update_element", "b", new Position(3, 4), null), ops[1]);
    }
}
