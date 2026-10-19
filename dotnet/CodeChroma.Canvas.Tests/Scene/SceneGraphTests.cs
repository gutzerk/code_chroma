namespace CodeChroma.Canvas.Tests.Scene;

/// <summary>New: positions and sizes live in the model (no DOM measurement), with culling for off-screen boxes.</summary>
public class SceneGraphTests
{
    private sealed class FixedMeasurer : ITextMeasurer
    {
        public double LineHeight => 20;
        public int Lines { get; init; } = 1;
        public TextSize Measure(string text, double maxWidth, double fontSize) => new(Math.Min(maxWidth, text.Length * 7.0), Lines * LineHeight);
    }

    [Fact]
    public void An_unsized_centre_anchored_element_defaults_to_the_shared_footprint_around_its_position()
    {
        var scene = new SceneGraph(Fx.DocOf(Fx.Element("a", x: 150, y: 36)));

        Assert.Equal(new Rect(0, 0, 300, 72), scene.RectOf("a"));
    }

    [Fact]
    public void An_explicit_size_wins_over_the_default()
    {
        var scene = new SceneGraph(Fx.DocOf(Fx.Element("a", x: 100, y: 50, size: new double[] { 200, 100 })));

        Assert.Equal(new Rect(0, 0, 200, 100), scene.RectOf("a"));
    }

    [Theory]
    [InlineData(RenderKind.Epic)]
    [InlineData(RenderKind.Spec)]
    [InlineData(RenderKind.Task)]
    public void Epics_kinds_are_anchored_at_their_bottom_left_corner(RenderKind kind)
    {
        var scene = new SceneGraph(Fx.DocOf(Fx.Element("a", render: kind, x: 40, y: 172)));

        Assert.Equal(new Rect(40, 100, 300, 72), scene.RectOf("a"));
    }

    [Fact]
    public void Text_measured_by_the_layout_engine_grows_an_unsized_box_instead_of_a_css_line_clamp()
    {
        var doc = Fx.DocOf(Fx.Element("a", description: new string('x', 400)));
        var scene = new SceneGraph(doc, new FixedMeasurer { Lines = 3 });

        var rect = scene.RectOf("a");

        Assert.Equal(300, rect.Width);
        Assert.True(rect.Height > 72);
    }

    [Fact]
    public void Description_height_is_clamped_to_the_line_limit()
    {
        var doc = Fx.DocOf(Fx.Element("a", description: new string('x', 4000)));
        var many = new SceneGraph(doc, new FixedMeasurer { Lines = 50 }).RectOf("a");
        var clamped = new SceneGraph(doc, new FixedMeasurer { Lines = SceneGraph.DescriptionLineClamp }).RectOf("a");

        Assert.Equal(clamped.Height, many.Height);
    }

    [Fact]
    public void An_explicit_size_is_never_overridden_by_measured_text()
    {
        var doc = Fx.DocOf(Fx.Element("a", description: new string('x', 400), size: new double[] { 300, 72 }));
        var scene = new SceneGraph(doc, new FixedMeasurer { Lines = 10 });

        Assert.Equal(72, scene.RectOf("a").Height);
    }

    [Fact]
    public void Bounds_enclose_every_element()
    {
        var scene = new SceneGraph(Fx.DocOf(Fx.Element("a", x: 150, y: 36), Fx.Element("b", x: 1150, y: 836)));

        Assert.Equal(new Rect(0, 0, 1300, 872), scene.Bounds);
    }

    [Fact]
    public void Moving_an_element_updates_its_rect_and_the_spatial_index()
    {
        var scene = new SceneGraph(Fx.DocOf(Fx.Element("a", x: 150, y: 36)));
        var far = new Rect(5000, 5000, 100, 100);

        scene.Move("a", new Position(5050, 5050));

        Assert.Equal(new[] { "a" }, scene.Query(far).Select(n => n.Id).ToArray());
        Assert.Empty(scene.Query(new Rect(0, 0, 100, 100)));
    }

    [Fact]
    public void Query_returns_only_elements_intersecting_the_visible_rect_out_of_ten_thousand()
    {
        var elements = Enumerable.Range(0, 10_000)
            .Select(i => Fx.Element($"n{i}", x: (i % 100) * 400 + 150, y: (i / 100) * 200 + 36))
            .ToArray();
        var scene = new SceneGraph(Fx.DocOf(elements));
        var visible = new Rect(0, 0, 1000, 500);

        var hits = scene.Query(visible).Select(n => n.Id).ToHashSet();

        var brute = elements.Where(e => scene.RectOf(e.Id).Intersects(visible)).Select(e => e.Id).ToHashSet();
        Assert.Equal(brute, hits);
        Assert.InRange(hits.Count, 1, 40);
    }

    [Fact]
    public void Culling_follows_the_viewport_so_off_screen_boxes_are_not_realised()
    {
        var scene = new SceneGraph(Fx.DocOf(Fx.Element("near", x: 150, y: 36), Fx.Element("far", x: 9000, y: 9000)));
        var viewport = new Viewport(new ViewState(0, 0, 1), 800, 600);

        var visible = scene.Cull(viewport, margin: 0).Select(n => n.Id).ToArray();
        viewport.Pan(-8800, -8800);
        var afterPan = scene.Cull(viewport, margin: 0).Select(n => n.Id).ToArray();

        Assert.Equal(new[] { "near" }, visible);
        Assert.Equal(new[] { "far" }, afterPan);
    }

    [Fact]
    public void A_margin_realises_boxes_just_outside_the_view_so_a_pan_does_not_pop()
    {
        var scene = new SceneGraph(Fx.DocOf(Fx.Element("edge", x: 950, y: 36)));
        var viewport = new Viewport(new ViewState(0, 0, 1), 800, 600);

        Assert.Empty(scene.Cull(viewport, margin: 0));
        Assert.Single(scene.Cull(viewport, margin: 400));
    }
}
