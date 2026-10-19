namespace CodeChroma.Canvas.Tests.Connectors;

public class ObstacleRouterTests
{
    public static IEnumerable<object[]> Cases => Fx.Cases("obstacle_router.json", "cases");

    private static Rect R(double left, double top, double width = 100, double height = 60) => new(left, top, width, height);

    /// <summary>Written independently of the router's own crossing test on purpose, so one bug cannot hide the other.</summary>
    private static bool PassesThrough(IReadOnlyList<Point> points, Rect box)
    {
        for (var i = 0; i + 1 < points.Count; i++)
        {
            var (a, b) = (points[i], points[i + 1]);
            var (loX, hiX) = (Math.Min(a.X, b.X), Math.Max(a.X, b.X));
            var (loY, hiY) = (Math.Min(a.Y, b.Y), Math.Max(a.Y, b.Y));
            if (loX < box.Right && box.Left < hiX && loY < box.Bottom && box.Top < hiY) return true;
        }
        return false;
    }

    [Theory, MemberData(nameof(Cases))]
    public void Router_steers_around_boxes_and_degrades_gracefully(string name, string json)
    {
        var c = Fx.Parse(json);
        var from = Fx.R(c.GetProperty("from"));
        var to = Fx.R(c.GetProperty("to"));
        var obstacles = c.GetProperty("obstacles").EnumerateArray().Select(Fx.R).ToList();
        if (c.TryGetProperty("obstacleRow", out var row))
        {
            for (var i = 0; i < row.GetProperty("count").GetInt32(); i++)
                obstacles.Add(new Rect(i * row.GetProperty("step").GetDouble(), row.GetProperty("top").GetDouble(),
                    row.GetProperty("width").GetDouble(), row.GetProperty("height").GetDouble()));
        }
        if (c.TryGetProperty("repeated", out var rep))
        {
            for (var i = 0; i < rep.GetProperty("count").GetInt32(); i++) obstacles.Add(Fx.R(rep.GetProperty("rect")));
        }
        var blockers = c.TryGetProperty("blockers", out var b) ? b.EnumerateArray().Select(Fx.R).ToList() : new List<Rect>();
        var direct = OrthogonalRoute.RouteConnector(from, to);

        var route = new ObstacleRouter(obstacles).Route(from, to);

        foreach (var expect in c.GetProperty("expect").EnumerateArray().Select(e => e.GetString()))
        {
            switch (expect)
            {
                case "avoidsBlockers": Assert.All(blockers, box => Assert.False(PassesThrough(route.Points, box))); break;
                case "avoidsEndpointBoxes": Assert.False(PassesThrough(route.Points, from)); Assert.False(PassesThrough(route.Points, to)); break;
                case "endpointsMatchDirect":
                    Assert.Equal(direct.Points[0], route.Points[0]);
                    Assert.Equal(direct.Points[^1], route.Points[^1]);
                    break;
                case "axisAligned":
                    for (var i = 0; i + 1 < route.Points.Count; i++)
                        Assert.False(route.Points[i].X != route.Points[i + 1].X && route.Points[i].Y != route.Points[i + 1].Y);
                    break;
                case "labelDiffersFromDirect": Assert.NotEqual(direct.Label, route.Label); break;
                case "equalsDirect": Assert.Equal(direct.D, route.D); break;
                case "nonEmpty": Assert.True(route.Points.Count > 1); Assert.NotEqual("", route.D); break;
                default: throw new InvalidOperationException($"unknown expectation {expect}");
            }
        }
    }

    [Fact]
    public void A_second_arrow_from_another_pair_is_pushed_off_the_corridor_the_first_claimed()
    {
        Rect a = R(0, 0), b = R(0, 400), c = R(200, 0), d = R(200, 400);
        var router = new ObstacleRouter(new[] { a, b, c, d, R(-20, 190, 140), R(180, 190, 140) });

        var first = router.Route(a, b);
        var second = router.Route(c, d);

        Assert.NotEqual(first.D, second.D);
    }

    [Fact]
    public void A_later_clean_arrow_steps_to_a_neighbouring_lane_instead_of_drawing_on_the_first_stroke()
    {
        Rect a = R(0, 0), b = R(400, 0);
        var router = new ObstacleRouter(new[] { a, b });

        var first = router.Route(a, b);
        var second = router.Route(a, b);

        Assert.NotEqual(first.D, second.D);
        Assert.True(second.Points.Count > first.Points.Count);
    }

    [Fact]
    public void The_same_input_yields_byte_identical_geometry()
    {
        Rect from = R(0, 0), to = R(0, 400);
        var obstacles = new[] { from, to, R(-20, 190, 140) };

        var first = new ObstacleRouter(obstacles).Route(from, to);
        var second = new ObstacleRouter(obstacles).Route(from, to);

        Assert.Equal(first.D, second.D);
    }
}
