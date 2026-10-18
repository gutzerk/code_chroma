namespace CodeChroma.Canvas.Tests.Collision;

/// <summary>collisionStore.test.ts rewritten: participants report canvas-space boxes from the model, not getBoundingClientRect.</summary>
public class CollisionRegistryTests
{
    private static Box? Rect(double x, double y, double w, double h) => new Box(x, y, w, h);

    [Fact]
    public void The_dragged_block_is_never_its_own_obstacle()
    {
        var registry = new CollisionRegistry();
        registry.Register("a", () => Rect(0, 0, 240, 72));
        registry.Register("b", () => Rect(300, 0, 240, 72));

        var obstacles = registry.ObstaclesExcept("a");

        Assert.Equal(new[] { "b" }, obstacles.Select(o => o.Id).ToArray());
    }

    [Fact]
    public void A_participant_the_dragged_block_is_nested_inside_is_dropped_and_vice_versa()
    {
        var registry = new CollisionRegistry();
        registry.Register("outer", () => Rect(0, 0, 400, 400));
        registry.Register("inner", () => Rect(10, 10, 100, 100), containerId: "outer");
        registry.Register("other", () => Rect(900, 0, 240, 72));

        var forInner = registry.ObstaclesExcept("inner");
        var forOuter = registry.ObstaclesExcept("outer");

        Assert.Equal(new[] { "other" }, forInner.Select(o => o.Id).ToArray());
        Assert.Equal(new[] { "other" }, forOuter.Select(o => o.Id).ToArray());
    }

    [Fact]
    public void Nesting_is_followed_through_several_levels()
    {
        var registry = new CollisionRegistry();
        registry.Register("root", () => Rect(0, 0, 900, 900));
        registry.Register("mid", () => Rect(10, 10, 500, 500), containerId: "root");
        registry.Register("leaf", () => Rect(20, 20, 50, 50), containerId: "mid");
        registry.Register("sibling", () => Rect(700, 700, 50, 50));

        var forLeaf = registry.ObstaclesExcept("leaf");

        Assert.Equal(new[] { "sibling" }, forLeaf.Select(o => o.Id).ToArray());
    }

    [Theory]
    [InlineData(0, 0)]
    [InlineData(0, 72)]
    [InlineData(240, 0)]
    public void A_participant_that_is_not_laid_out_is_ignored_instead_of_becoming_a_box_at_the_origin(double w, double h)
    {
        var registry = new CollisionRegistry();
        registry.Register("a", () => Rect(0, 0, 240, 72));
        registry.Register("empty", () => Rect(0, 0, w, h));
        registry.Register("gone", () => null);

        var obstacles = registry.ObstaclesExcept("a");

        Assert.Empty(obstacles);
    }

    [Fact]
    public void A_participant_outside_the_canvas_space_is_ignored()
    {
        var registry = new CollisionRegistry();
        registry.Register("a", () => Rect(0, 0, 240, 72));
        registry.Register("popup", () => Rect(0, 0, 400, 300), inCanvasSpace: false);

        var obstacles = registry.ObstaclesExcept("a");

        Assert.Empty(obstacles);
    }

    [Fact]
    public void A_closed_panel_frees_its_space_the_moment_it_unregisters()
    {
        var registry = new CollisionRegistry();
        registry.Register("a", () => Rect(0, 0, 240, 72));
        var panel = registry.Register("panel", () => Rect(300, 0, 240, 72));

        var before = registry.ObstaclesExcept("a");
        panel.Dispose();

        Assert.Equal(new[] { "panel" }, before.Select(o => o.Id).ToArray());
        Assert.Empty(registry.ObstaclesExcept("a"));
    }

    [Fact]
    public void A_gesture_holds_the_frozen_boxes_rather_than_rereading_them_per_frame()
    {
        var registry = new CollisionRegistry();
        var bBox = Rect(300, 0, 240, 72);
        registry.Register("a", () => Rect(0, 0, 240, 72));
        registry.Register("b", () => bBox);
        registry.BeginGesture();

        bBox = Rect(9000, 9000, 240, 72);
        var during = registry.ObstaclesExcept("a");
        registry.EndGesture();

        Assert.Equal(300, during[0].Bounds.X);
        Assert.Equal(9000, registry.ObstaclesExcept("a")[0].Bounds.X);
    }

    [Fact]
    public void Disposing_a_stale_registration_does_not_remove_the_participant_that_replaced_it()
    {
        var registry = new CollisionRegistry();
        var stale = registry.Register("a", () => Rect(0, 0, 240, 72));
        registry.Register("a", () => Rect(500, 0, 240, 72));
        registry.Register("b", () => Rect(900, 0, 240, 72));

        stale.Dispose();

        Assert.Equal(new[] { "a" }, registry.ObstaclesExcept("b").Select(o => o.Id).ToArray());
    }
}
