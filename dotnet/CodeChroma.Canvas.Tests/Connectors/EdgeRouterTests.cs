namespace CodeChroma.Canvas.Tests.Connectors;

public class EdgeRouterTests
{
    private sealed record Relation(string From, string To);

    private static Rect R(double left, double top, double width = 100, double height = 60) => new(left, top, width, height);

    private static IReadOnlyList<RoutedEdge<Relation>> Route(IReadOnlyDictionary<string, Rect> boxes, params Relation[] relations) =>
        EdgeRouter.Route(
            relations,
            r => OrthogonalRoute.PairKeyOf(r.From, r.To),
            r => boxes.ContainsKey(r.From) && boxes.ContainsKey(r.To) ? new RoutedEndpoints(boxes[r.From], boxes[r.To]) : null,
            boxes.Values.ToList());

    [Theory]
    [InlineData(0, 200, 60, 130)]
    [InlineData(60, 130, 100, 150)]
    public void Two_arrows_into_one_side_from_different_pairs_spread_symmetrically_around_the_midpoint(
        double aTop, double bTop, double targetHeight, double midpoint)
    {
        var boxes = new Dictionary<string, Rect> { ["a"] = R(0, aTop), ["b"] = R(0, bTop), ["c"] = R(400, 100, 100, targetHeight) };

        var routed = Route(boxes, new Relation("a", "c"), new Relation("b", "c"));

        var anchors = routed.Select(e => e.Route.Points[^1]).ToList();
        Assert.Equal(new[] { 400.0, 400.0 }, anchors.Select(p => p.X).ToArray());
        Assert.NotEqual(anchors[0].Y, anchors[1].Y);
        Assert.Equal(midpoint, (anchors[0].Y + anchors[1].Y) / 2, 6);
        Assert.Equal(26, Math.Abs(anchors[1].Y - anchors[0].Y), 6);
    }

    [Fact]
    public void Exits_order_by_target_not_input_so_bottom_exits_do_not_cross()
    {
        var boxes = new Dictionary<string, Rect> { ["a"] = R(300, 0), ["b"] = R(20, 300), ["c"] = R(580, 300) };

        var routed = Route(boxes, new Relation("a", "c"), new Relation("a", "b"));

        Assert.True(routed[0].Route.Points[0].X > routed[1].Route.Points[0].X);
    }

    [Fact]
    public void Side_exits_order_by_target_not_input_so_side_exits_do_not_cross()
    {
        var boxes = new Dictionary<string, Rect> { ["a"] = R(0, 0, 60, 120), ["up"] = R(300, -200), ["down"] = R(300, 200) };

        var routed = Route(boxes, new Relation("a", "down"), new Relation("a", "up"));

        var (exitDown, exitUp) = (routed[0].Route.Points[0], routed[1].Route.Points[0]);
        Assert.Equal(60, exitDown.X);
        Assert.Equal(60, exitUp.X);
        Assert.True(exitUp.Y < exitDown.Y);
    }

    [Fact]
    public void A_single_arrow_into_a_box_lands_on_the_side_midpoint()
    {
        var boxes = new Dictionary<string, Rect> { ["a"] = R(0, 0), ["c"] = R(400, 0) };

        var routed = Route(boxes, new Relation("a", "c"));

        Assert.Equal(new Point(400, 30), routed[0].Route.Points[^1]);
    }

    [Fact]
    public void Arrows_stay_spread_when_one_box_is_measured_at_slightly_different_rects_per_edge()
    {
        var (a, b) = (R(0, 0), R(0, 200));
        var (c1, c2) = (new Rect(400, 100, 300.6, 72.4), new Rect(400, 100, 299.4, 72.6));
        var items = new[] { "1", "2" };

        var routed = EdgeRouter.Route(
            items, i => i,
            i => i == "1" ? new RoutedEndpoints(a, c1, "a", "c") : new RoutedEndpoints(b, c2, "b", "c"),
            new[] { a, b, c1, c2 });

        var anchors = routed.Select(e => e.Route.Points[^1]).ToList();
        Assert.Equal(400, anchors[0].X);
        Assert.Equal(400, anchors[1].X);
        Assert.Equal(26, Math.Abs(anchors[1].Y - anchors[0].Y), 0);
    }

    [Fact]
    public void An_out_arrow_and_an_in_arrow_sharing_one_side_are_spread_together()
    {
        var c = new Rect(400, 100, 300, 150);
        var (a, b) = (new Rect(900, 50, 200, 120), new Rect(900, 400, 200, 120));

        var routed = EdgeRouter.Route(
            new[] { "out", "in" }, i => i,
            i => i == "out" ? new RoutedEndpoints(c, a, "c", "a") : new RoutedEndpoints(b, c, "b", "c"),
            new[] { c, a, b });

        var (exit, enter) = (routed[0].Route.Points[0], routed[1].Route.Points[^1]);
        Assert.Equal(700, exit.X);
        Assert.Equal(700, enter.X);
        Assert.Equal(26, Math.Abs(exit.Y - enter.Y), 6);
    }

    [Fact]
    public void An_unresolved_item_is_skipped_but_still_consumes_its_lane()
    {
        var boxes = new Dictionary<string, Rect> { ["a"] = R(0, 0), ["c"] = R(400, 0) };

        var routed = Route(boxes, new Relation("a", "missing"), new Relation("a", "c"));

        Assert.Single(routed);
    }
}
