namespace CodeChroma.Canvas.Tests.Scene;

/// <summary>New: the single-matrix camera that replaces CanvasViewport.tsx's CSS transform + getBoundingClientRect measuring.</summary>
public class ViewportTests
{
    private static Viewport Make(double x = 0, double y = 0, double scale = 1, double w = 1000, double h = 600) =>
        new(new ViewState(x, y, scale), w, h);

    [Theory]
    [InlineData(1.0, 4.0, 2.5)]
    [InlineData(1.0, 0.01, 0.25)]
    [InlineData(1.0, 1.12, 1.12)]
    public void Zoom_is_clamped_to_the_camera_limits(double start, double factor, double expected)
    {
        var viewport = Make(scale: start);

        viewport.ZoomAround(new Point(0, 0), factor);

        Assert.Equal(expected, viewport.State.Scale, 9);
    }

    [Theory]
    [InlineData(300, 200, 1.12)]
    [InlineData(0, 0, 2.0)]
    [InlineData(999, 599, 0.5)]
    public void Zooming_keeps_the_canvas_point_under_the_cursor_fixed(double cx, double cy, double factor)
    {
        var viewport = Make(x: 40, y: -25, scale: 0.8);
        var cursor = new Point(cx, cy);
        var under = viewport.ScreenToCanvas(cursor);

        viewport.ZoomAround(cursor, factor);

        var after = viewport.CanvasToScreen(under);
        Assert.Equal(cursor.X, after.X, 6);
        Assert.Equal(cursor.Y, after.Y, 6);
    }

    [Theory]
    [InlineData(0, 0, 1)]
    [InlineData(120, -80, 0.5)]
    [InlineData(-300, 40, 2.5)]
    public void Screen_and_canvas_coordinates_round_trip(double x, double y, double scale)
    {
        var viewport = Make(x, y, scale);
        var p = new Point(321.5, -17.25);

        var back = viewport.ScreenToCanvas(viewport.CanvasToScreen(p));

        Assert.Equal(p.X, back.X, 9);
        Assert.Equal(p.Y, back.Y, 9);
    }

    [Fact]
    public void A_screen_gap_measured_while_zoomed_out_is_the_canvas_gap_after_unprojecting()
    {
        var viewport = Make(scale: 0.5);
        var screenGap = CollisionConstants.NodeSep / 2;

        var canvasGap = viewport.ScreenToCanvas(new Point(screenGap, 0)).X - viewport.ScreenToCanvas(new Point(0, 0)).X;

        Assert.Equal(CollisionConstants.NodeSep, canvasGap, 9);
    }

    [Fact]
    public void Panning_moves_the_view_in_screen_pixels_without_changing_scale()
    {
        var viewport = Make(scale: 2);

        viewport.Pan(15, -5);

        Assert.Equal(new ViewState(15, -5, 2), viewport.State);
    }

    [Fact]
    public void The_visible_canvas_rect_is_the_screen_viewport_unprojected()
    {
        var viewport = Make(x: -200, y: -100, scale: 2, w: 1000, h: 600);

        var rect = viewport.VisibleCanvasRect();

        Assert.Equal(new Rect(100, 50, 500, 300), rect);
    }

    [Fact]
    public void Fit_centres_the_target_in_the_view_with_padding_and_clamps_the_scale()
    {
        var viewport = Make(w: 1000, h: 600);

        var view = viewport.ComputeFit(new Rect(100, 100, 500, 300));

        Assert.Equal(1.4, view.Scale, 9);
        var centre = new Viewport(view, 1000, 600).CanvasToScreen(new Point(350, 250));
        Assert.Equal(500, centre.X, 6);
        Assert.Equal(300, centre.Y, 6);
    }

    [Theory]
    [InlineData(10_000, 10_000, 3.5)]
    [InlineData(100_000, 100_000, 0.25)]
    public void Fit_never_exceeds_the_focus_ceiling_or_drops_below_the_floor(double w, double h, double expectedScale)
    {
        var viewport = Make(w: 1000, h: 600);
        var target = expectedScale > 1 ? new Rect(0, 0, 10, 10) : new Rect(0, 0, w, h);

        Assert.Equal(expectedScale, viewport.ComputeFit(target).Scale, 9);
    }

    [Fact]
    public void The_matrix_maps_canvas_to_screen_like_CanvasToScreen()
    {
        var viewport = Make(x: 30, y: 40, scale: 1.5);

        var m = viewport.Matrix;
        var p = System.Numerics.Vector2.Transform(new System.Numerics.Vector2(10, 20), m);

        var expected = viewport.CanvasToScreen(new Point(10, 20));
        Assert.Equal(expected.X, p.X, 4);
        Assert.Equal(expected.Y, p.Y, 4);
    }

    [Fact]
    public void Fit_with_an_explicit_ceiling_stays_at_or_below_it()
    {
        var viewport = Make(w: 1000, h: 600);

        var view = viewport.ComputeFit(new Rect(0, 0, 10, 10), Viewport.MaxScale);

        Assert.Equal(Viewport.MaxScale, view.Scale, 9);
    }
}
