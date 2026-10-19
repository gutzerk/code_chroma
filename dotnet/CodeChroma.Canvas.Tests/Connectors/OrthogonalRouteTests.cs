namespace CodeChroma.Canvas.Tests.Connectors;

public class OrthogonalRouteTests
{
    private const string File = "orthogonal_route.json";

    public static IEnumerable<object[]> ChooseSidesCases => Fx.Cases(File, "chooseSides");
    public static IEnumerable<object[]> AnchorCases => Fx.Cases(File, "anchorOf");
    public static IEnumerable<object[]> LaneCases => Fx.Cases(File, "assignLanes");
    public static IEnumerable<object[]> PortCases => Fx.Cases(File, "assignPorts");
    public static IEnumerable<object[]> SimplifyCases => Fx.Cases(File, "simplify");
    public static IEnumerable<object[]> RoundedCases => Fx.Cases(File, "roundedPath");
    public static IEnumerable<object[]> LabelCases => Fx.Cases(File, "labelPointOf");
    public static IEnumerable<object[]> RouteCases => Fx.Cases(File, "routeConnector");
    public static IEnumerable<object[]> LaneSeparationCases => Fx.Cases(File, "laneSeparation");

    [Theory, MemberData(nameof(ChooseSidesCases))]
    public void ChooseSides_leaves_and_enters_through_the_facing_sides(string name, string json)
    {
        var c = Fx.Parse(json);

        var (from, to) = OrthogonalRoute.ChooseSides(Fx.R(c.GetProperty("from")), Fx.R(c.GetProperty("to")));

        var expected = c.GetProperty("expected").EnumerateArray().Select(e => e.GetString()!).ToArray();
        Assert.Equal(expected, new[] { from.ToString().ToLowerInvariant(), to.ToString().ToLowerInvariant() });
    }

    [Theory, MemberData(nameof(AnchorCases))]
    public void AnchorOf_shifts_along_the_side_and_clamps_onto_it(string name, string json)
    {
        var c = Fx.Parse(json);

        var anchor = OrthogonalRoute.AnchorOf(Fx.R(c.GetProperty("rect")), Fx.S(c.GetProperty("side").GetString()!), c.GetProperty("offset").GetDouble());

        Fx.AssertPoint(Fx.P(c.GetProperty("expected")), anchor);
    }

    [Theory, MemberData(nameof(LaneCases))]
    public void AssignLanes_spreads_arrows_of_one_pair_symmetrically(string name, string json)
    {
        var c = Fx.Parse(json);
        var pairs = c.GetProperty("pairs").EnumerateArray().Select(p => (A: p[0].GetString()!, B: p[1].GetString()!)).ToList();
        var gap = c.TryGetProperty("gap", out var g) ? g.GetDouble() : Connector.LaneGap;

        var lanes = OrthogonalRoute.AssignLanes(pairs, p => OrthogonalRoute.PairKeyOf(p.A, p.B), gap);

        var expected = c.GetProperty("expected").EnumerateArray().Select(Fx.Nums).ToList();
        Assert.Equal(expected.Count, lanes.Count);
        for (var i = 0; i < lanes.Count; i++)
        {
            Assert.Equal(expected[i][0], lanes[i].Offset, 6);
            Assert.Equal((int)expected[i][1], lanes[i].Rank);
        }
    }

    [Theory, MemberData(nameof(PortCases))]
    public void AssignPorts_spreads_by_box_and_side_not_by_pair(string name, string json)
    {
        var c = Fx.Parse(json);
        var keys = c.GetProperty("keys").EnumerateArray().Select(k => k.GetString()!).ToList();
        var gap = c.TryGetProperty("gap", out var g) ? g.GetDouble() : Connector.PortGap;

        var offsets = OrthogonalRoute.AssignPorts(keys, gap);

        Assert.Equal(Fx.Nums(c.GetProperty("expected")), offsets.ToArray());
    }

    [Theory, MemberData(nameof(SimplifyCases))]
    public void Simplify_drops_repeated_and_collinear_corners(string name, string json)
    {
        var c = Fx.Parse(json);

        var result = OrthogonalRoute.Simplify(c.GetProperty("points").EnumerateArray().Select(Fx.P).ToList());

        Assert.Equal(c.GetProperty("expected").EnumerateArray().Select(Fx.P).ToList(), result.ToList());
    }

    [Theory, MemberData(nameof(RoundedCases))]
    public void RoundedPath_rounds_corners_and_shrinks_on_short_segments(string name, string json)
    {
        var c = Fx.Parse(json);
        var radius = c.TryGetProperty("radius", out var r) ? r.GetDouble() : Connector.Corner;

        var d = OrthogonalRoute.RoundedPath(c.GetProperty("points").EnumerateArray().Select(Fx.P).ToList(), radius);

        Assert.Equal(c.GetProperty("expected").GetString(), d);
    }

    [Theory, MemberData(nameof(LabelCases))]
    public void LabelPointOf_prefers_the_arc_midpoint_and_clears_boxes(string name, string json)
    {
        var c = Fx.Parse(json);

        var label = OrthogonalRoute.LabelPointOf(
            c.GetProperty("points").EnumerateArray().Select(Fx.P).ToList(),
            c.GetProperty("avoid").EnumerateArray().Select(Fx.R).ToList());

        Fx.AssertPoint(Fx.P(c.GetProperty("expected")), label);
    }

    [Theory, MemberData(nameof(RouteCases))]
    public void RouteConnector_draws_the_expected_whiteboard_route(string name, string json)
    {
        var c = Fx.Parse(json);
        Lane? lane = c.TryGetProperty("lane", out var l)
            ? new Lane(l.GetProperty("offset").GetDouble(), l.GetProperty("rank").GetInt32())
            : null;

        var route = OrthogonalRoute.RouteConnector(Fx.R(c.GetProperty("from")), Fx.R(c.GetProperty("to")), lane);

        var e = c.GetProperty("expect");
        if (e.TryGetProperty("d", out var d)) Assert.Equal(d.GetString(), route.D);
        if (e.TryGetProperty("corners", out var corners))
        {
            var expected = corners.EnumerateArray().Select(Fx.P).ToList();
            var actual = Fx.Corners(route.D);
            Assert.Equal(expected.Count, actual.Count);
            for (var i = 0; i < expected.Count; i++) Fx.AssertPoint(expected[i], actual[i]);
        }
        if (e.TryGetProperty("cornerYRange", out var yr))
        {
            var ys = Fx.Corners(route.D).Select(p => p.Y).ToList();
            Assert.Equal(Fx.Nums(yr), new[] { ys.Min(), ys.Max() });
        }
        if (e.TryGetProperty("cornerXRange", out var xr))
        {
            var xs = Fx.Corners(route.D).Select(p => p.X).ToList();
            Assert.Equal(Fx.Nums(xr), new[] { xs.Min(), xs.Max() });
        }
        if (e.TryGetProperty("label", out var label)) Fx.AssertPoint(Fx.P(label), route.Label);
        if (e.TryGetProperty("point1", out var p1)) Fx.AssertPoint(Fx.P(p1), route.Points[1]);
    }

    [Theory, MemberData(nameof(LaneSeparationCases))]
    public void Lanes_of_one_pair_draw_on_separate_strokes(string name, string json)
    {
        var c = Fx.Parse(json);
        var from = Fx.R(c.GetProperty("from"));
        var to = Fx.R(c.GetProperty("to"));
        var count = c.GetProperty("count").GetInt32();
        var reverseOdd = c.GetProperty("reverseOdd").GetBoolean();
        var lanes = OrthogonalRoute.AssignLanes(Enumerable.Range(0, count).ToList(), _ => "pair");

        var routes = lanes
            .Select((lane, i) => reverseOdd && i % 2 == 1
                ? OrthogonalRoute.RouteConnector(to, from, lane)
                : OrthogonalRoute.RouteConnector(from, to, lane))
            .ToList();

        Assert.True(routes.Select(r => r.D).Distinct().Count() >= c.GetProperty("distinctD").GetInt32());
        Assert.True(routes.Select(r => r.Label).Distinct().Count() >= c.GetProperty("distinctLabels").GetInt32());
    }

    [Fact]
    public void RectFromBox_reads_centre_based_coordinates_as_a_rect()
    {
        var rect = OrthogonalRoute.RectFromBox(100, 50, 40, 20);

        Assert.Equal(new Rect(80, 40, 40, 20), rect);
    }

    [Fact]
    public void PairKeyOf_is_direction_insensitive()
    {
        Assert.Equal(OrthogonalRoute.PairKeyOf("a", "b"), OrthogonalRoute.PairKeyOf("b", "a"));
    }

    [Fact]
    public void RoundedPath_prints_numbers_with_the_invariant_culture_and_never_negative_zero()
    {
        var d = OrthogonalRoute.RoundedPath(new List<Point> { new(-0.0, 0), new(100.5, 0) });

        Assert.Equal("M 0 0 L 100.5 0", d);
    }
}
