namespace CodeChroma.Canvas.Tests.Layout;

/// <summary>elkLayout.test.ts + diagramLayout.test.ts (layoutBoxes) as the contract of the native layered layout that replaces elkjs.</summary>
public class LayeredLayoutTests
{
    private static LayoutBoxSpec Box(string id, string? order = null, string? lane = null, double w = 20, double h = 10) =>
        new(id, w, h, order, lane);

    private static LayoutEdge Edge(string from, string to) => new(from, to);

    private static PositionedBox Of(LayoutResult r, string id) => r.Boxes.Single(b => b.Id == id);

    private static bool NoOverlaps(IReadOnlyList<PositionedBox> boxes) =>
        boxes.Select((b, i) => !DropResolver.HasCollision(AsBox(b),
                boxes.Where((_, j) => j != i).Select(o => new Obstacle(o.Id, AsBox(o))).ToList()))
            .All(ok => ok);

    private static Box AsBox(PositionedBox b) => new(b.X - b.Width / 2, b.Y - b.Height / 2, b.Width, b.Height);

    [Fact]
    public void Empty_input_returns_the_fallback_dimensions()
    {
        var result = LayeredLayout.Compute(new List<LayoutBoxSpec>(), new List<LayoutEdge>());

        Assert.Empty(result.Boxes);
        Assert.Equal((600.0, 400.0), (result.Width, result.Height));
    }

    [Fact]
    public void A_chain_plus_a_disconnected_pair_is_deterministic_and_does_not_overlap()
    {
        var nodes = new[] { Box("a"), Box("b"), Box("c"), Box("p1"), Box("p2") };
        var edges = new[] { Edge("a", "b"), Edge("b", "c"), Edge("p1", "p2") };

        var first = LayeredLayout.Compute(nodes, edges);
        var second = LayeredLayout.Compute(nodes, edges);

        Assert.Equal(first.Boxes, second.Boxes);
        Assert.True(NoOverlaps(first.Boxes));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void Every_source_sits_above_its_target_along_a_chain_and_across_a_cycle(bool closeTheCycle)
    {
        var edges = closeTheCycle
            ? new[] { Edge("a", "b"), Edge("b", "c"), Edge("c", "a") }
            : new[] { Edge("a", "b"), Edge("b", "c") };

        var result = LayeredLayout.Compute(new[] { Box("a"), Box("b"), Box("c") }, edges);

        Assert.True(Of(result, "a").Y < Of(result, "b").Y);
        Assert.True(Of(result, "b").Y < Of(result, "c").Y);
    }

    [Fact]
    public void Self_loops_duplicates_and_edges_to_missing_ids_are_skipped()
    {
        var edges = new[] { Edge("a", "a"), Edge("a", "b"), Edge("a", "b"), Edge("a", "missing") };

        var result = LayeredLayout.Compute(new[] { Box("a"), Box("b") }, edges);

        Assert.True(Of(result, "a").Y < Of(result, "b").Y);
    }

    [Fact]
    public void Returns_every_input_node_exactly_once_with_its_own_size()
    {
        var nodes = new[] { Box("a", w: 100, h: 50), Box("b", w: 100, h: 50), Box("c", w: 100, h: 50) };

        var result = LayeredLayout.Compute(nodes, new[] { new LayoutEdge("a", "b", "uses") });

        Assert.Equal(new[] { "a", "b", "c" }, result.Boxes.Select(b => b.Id).OrderBy(x => x).ToArray());
        Assert.All(result.Boxes, b => Assert.Equal((100.0, 50.0), (b.Width, b.Height)));
    }

    [Fact]
    public void Authored_order_overrides_topology()
    {
        var result = LayeredLayout.Compute(new[] { Box("a", "1"), Box("b", "2") }, new[] { Edge("b", "a") });

        Assert.True(Of(result, "a").Y < Of(result, "b").Y);
    }

    [Fact]
    public void Only_the_leading_digit_run_of_an_order_counts_and_an_unparseable_order_is_unset()
    {
        var nodes = new[] { Box("s"), Box("a", "12a"), Box("b", "3"), Box("x", "abc") };

        var result = LayeredLayout.Compute(nodes, new[] { Edge("s", "a"), Edge("s", "b"), Edge("x", "s") });

        Assert.True(Of(result, "b").Y < Of(result, "a").Y);
    }

    [Fact]
    public void Order_zero_is_clamped_to_the_same_layer_as_one_with_a_warning()
    {
        var warnings = new List<string>();

        var result = LayeredLayout.Compute(
            new[] { Box("a", "0"), Box("b", "1"), Box("c") }, new[] { Edge("a", "c"), Edge("b", "c") }, warnings.Add);

        Assert.Equal(Of(result, "a").Y, Of(result, "b").Y);
        Assert.Contains(warnings, w => w.Contains("meta.order \"0\""));
    }

    [Fact]
    public void Boxes_of_one_lane_sit_adjacent_within_a_layer()
    {
        var nodes = new[] { Box("a", lane: "ops"), Box("b"), Box("c", lane: "ops"), Box("d") };
        var edges = new[] { Edge("a", "d"), Edge("b", "d"), Edge("c", "d") };

        var result = LayeredLayout.Compute(nodes, edges);

        var order = new[] { "a", "b", "c" }.OrderBy(id => Of(result, id).X).Select(id => id).ToArray();
        Assert.Matches("^(ac|ca)b$|^b(ac|ca)$", string.Concat(order));
    }

    [Fact]
    public void Many_unconnected_blocks_pack_into_a_compact_grid_instead_of_one_endless_row()
    {
        var nodes = Enumerable.Range(0, 9).Select(i => Box($"b{i}", w: 300, h: 72)).ToList();

        var result = LayeredLayout.Compute(nodes, new List<LayoutEdge>());

        Assert.True(result.Boxes.Max(b => b.X) < 2000);
        Assert.True(result.Boxes.Max(b => b.Y) - result.Boxes.Min(b => b.Y) > 0);
        Assert.True(NoOverlaps(result.Boxes));
    }

    [Fact]
    public void A_large_diagram_lays_out_without_overlap_and_far_faster_than_the_elkjs_baseline()
    {
        var nodes = Enumerable.Range(0, 120).Select(i => Box($"b{i}", w: 300, h: 72)).ToList();
        var rng = new Random(12345);
        var edges = Enumerable.Range(0, 359).Select(_ => Edge($"b{rng.Next(120)}", $"b{rng.Next(120)}")).ToList();
        var watch = System.Diagnostics.Stopwatch.StartNew();

        var result = LayeredLayout.Compute(nodes, edges);

        watch.Stop();
        Assert.True(NoOverlaps(result.Boxes));
        Assert.True(watch.ElapsedMilliseconds < 1200, $"took {watch.ElapsedMilliseconds} ms; elkjs measured 1206 ms cold at this size");
    }
}
