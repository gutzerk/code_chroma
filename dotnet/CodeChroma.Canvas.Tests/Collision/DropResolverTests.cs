namespace CodeChroma.Canvas.Tests.Collision;

public class DropResolverTests
{
    public static IEnumerable<object[]> Scenarios => Fx.Cases("resolve_drop.json", "scenarios");

    private static Obstacle Obs(JsonElement e) =>
        new(e[0].GetString()!, new Box(e[1].GetDouble(), e[2].GetDouble(), e[3].GetDouble(), e[4].GetDouble()));

    private static (Box Moving, List<Obstacle> Obstacles, DropResolution Expected) Read(JsonElement c)
    {
        var x = c.GetProperty("expected");
        return (Fx.B(c.GetProperty("moving")),
            c.GetProperty("obstacles").EnumerateArray().Select(Obs).ToList(),
            new DropResolution(x.GetProperty("x").GetDouble(), x.GetProperty("y").GetDouble(), x.GetProperty("blocked").GetBoolean()));
    }

    [Theory, MemberData(nameof(Scenarios))]
    public void Resolve_lands_on_the_nearest_legal_position(string name, string json)
    {
        var c = Fx.Parse(json);
        var (moving, obstacles, expected) = Read(c);
        var runs = c.TryGetProperty("repeat", out var r) ? r.GetInt32() : 1;

        for (var i = 0; i < runs; i++) Assert.Equal(expected, DropResolver.Resolve(moving, obstacles));
    }

    [Theory, MemberData(nameof(Scenarios))]
    public void Resolve_leaves_no_gap_violation_behind(string name, string json)
    {
        var (moving, obstacles, _) = Read(Fx.Parse(json));

        var resolution = DropResolver.Resolve(moving, obstacles);

        Assert.False(DropResolver.HasCollision(moving with { X = resolution.X, Y = resolution.Y }, obstacles));
    }

    [Fact]
    public void Resolve_reports_the_release_point_as_blocked_when_the_whole_scene_is_dense()
    {
        var d = Fx.Load("resolve_drop.json").GetProperty("denseGrid");
        var obstacles = new List<Obstacle>();
        for (double x = d.GetProperty("from").GetDouble(); x <= d.GetProperty("to").GetDouble(); x += d.GetProperty("step").GetDouble())
        for (double y = d.GetProperty("from").GetDouble(); y <= d.GetProperty("to").GetDouble(); y += d.GetProperty("step").GetDouble())
            obstacles.Add(new Obstacle($"{x}:{y}", new Box(x, y, d.GetProperty("size").GetDouble(), d.GetProperty("size").GetDouble())));

        var resolution = DropResolver.Resolve(Fx.B(d.GetProperty("moving")), obstacles);

        Assert.Equal(new DropResolution(0, 0, true), resolution);
    }

    [Fact]
    public void Gap_is_anisotropic_a_side_by_side_landing_is_tighter_than_a_stacked_one()
    {
        var sideways = DropResolver.Resolve(new Box(150, 25, 100, 50), new[] { new Obstacle("a", new Box(200, 0, 200, 100)) });
        var stacked = DropResolver.Resolve(new Box(250, 170, 100, 50), new[] { new Obstacle("a", new Box(0, 200, 600, 200)) });

        Assert.Equal(CollisionConstants.NodeSep, 200 - (sideways.X + 100));
        Assert.Equal(CollisionConstants.RankSep, 200 - (stacked.Y + 50));
    }

    public class SpiralFallback
    {
        private static readonly double[] Centres = { -450, -300, -150, 0, 150, 300, 450 };
        private static readonly Box Moving = new(-100, -100, 200, 200);

        private static List<Obstacle> Grid() =>
            Centres.SelectMany(cx => Centres.Select(cy => new Obstacle($"{cx}:{cy}", new Box(cx - 20, cy - 20, 40, 40)))).ToList();

        [Fact]
        public void No_single_candidate_position_is_free_so_only_the_spiral_can_solve_the_scene()
        {
            var withoutSpiral = DropResolver.Resolve(Moving, Grid(), new ResolveDropOptions { MaxRing = 0 });

            Assert.Equal(new DropResolution(-100, -100, true), withoutSpiral);
        }

        [Fact]
        public void The_spiral_terminates_on_a_ring_position_clear_of_every_obstacle()
        {
            var grid = Grid();

            var resolution = DropResolver.Resolve(Moving, grid);

            Assert.False(resolution.Blocked);
            Assert.False(DropResolver.HasCollision(Moving with { X = resolution.X, Y = resolution.Y }, grid));
            Assert.Equal(0, Math.Abs(resolution.X - Moving.X) % CollisionConstants.RingStep);
            Assert.Equal(0, Math.Abs(resolution.Y - Moving.Y) % CollisionConstants.RingStep);
        }
    }
}
