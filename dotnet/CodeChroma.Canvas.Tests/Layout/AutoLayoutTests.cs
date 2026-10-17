namespace CodeChroma.Canvas.Tests.Layout;

public class AutoLayoutTests
{
    private static CanvasElement SeqEl(string id, string role, IDictionary<string, object?> meta, string label = "") =>
        Fx.Element(id, layer: "sequence", render: RenderKind.Sequence, label: label, meta: meta);

    [Fact]
    public void A_sequence_layer_is_laid_out_by_columns_and_time_rows()
    {
        var doc = Fx.DocOf(
            SeqEl("p1", "participant", new Dictionary<string, object?> { ["role"] = "participant", ["recipe_key"] = "client" }, "Client"),
            SeqEl("p2", "participant", new Dictionary<string, object?> { ["role"] = "participant", ["recipe_key"] = "api" }, "API"),
            SeqEl("m1", "message", new Dictionary<string, object?> { ["role"] = "message", ["from"] = "client", ["to"] = "api", ["order"] = "1" }),
            SeqEl("m2", "message", new Dictionary<string, object?> { ["role"] = "message", ["from"] = "api", ["to"] = "client", ["order"] = "2", ["return"] = "true" }));

        var result = AutoLayout.LayoutNewElements(doc, new[] { "p1", "p2", "m1", "m2" });

        Assert.Equal(130, result.Positions["p1"].X);
        Assert.Equal(390, result.Positions["p2"].X);
        Assert.Equal(260, result.Positions["m1"].X);
        Assert.Equal(260, result.Positions["m2"].X);
        Assert.True(result.Positions["m1"].Y < result.Positions["m2"].Y);
        Assert.Equal(new Size(180, 36), result.Sizes!["p1"]);
        Assert.True(result.Positions["p2"].X - result.Positions["p1"].X > 180);
    }

    [Fact]
    public void New_elements_land_below_an_existing_diagram_that_sits_entirely_above_y_zero()
    {
        var existing = Fx.Element("old1", layer: "kv-cache-resource-check", y: -200);
        var doc = Fx.DocOf(existing, Fx.Element("new1"));

        var result = AutoLayout.LayoutNewElements(doc, new[] { "new1" });

        Assert.True(result.Positions["new1"].Y > existing.Position.Y + 72.0 / 2);
    }

    [Fact]
    public void A_fresh_diagram_is_not_shifted_down_when_the_canvas_has_no_other_elements()
    {
        var doc = Fx.DocOf(Fx.Element("new1"));

        var result = AutoLayout.LayoutNewElements(doc, new[] { "new1" });

        Assert.True(result.Positions["new1"].Y < 80);
    }

    [Fact]
    public void An_epics_batch_takes_the_deterministic_column_layout_and_reports_fitted_sizes()
    {
        var doc = Fx.DocOf(
            Fx.Element("epic", layer: "epics", render: RenderKind.Epic, meta: new Dictionary<string, object?> { ["recipe_key"] = "EP-1" }),
            Fx.Element("story", layer: "epics", render: RenderKind.Spec, meta: new Dictionary<string, object?> { ["recipe_key"] = "EP-1::a" }));

        var result = AutoLayout.LayoutNewElements(doc, new[] { "epic", "story" });

        Assert.Equal(result.Positions["epic"].X, result.Positions["story"].X);
        Assert.True(result.Positions["story"].Y > result.Positions["epic"].Y);
        Assert.NotNull(result.Sizes);
    }

    public class IncrementalUpdate
    {
        private static CanvasDoc DocAt(double dx, double dy)
        {
            var doc = Fx.DocOf(
                Fx.Element("a", x: 300 + dx, y: 100 + dy),
                Fx.Element("b", x: 300 + dx, y: 400 + dy),
                Fx.Element("n"));
            return doc with
            {
                Edges = new Dictionary<string, CanvasEdge>
                {
                    ["a-b"] = new() { Id = "a-b", From = "a", To = "b", Kind = "uses", Layer = "c1" },
                    ["b-n"] = new() { Id = "b-n", From = "b", To = "n", Kind = "uses", Layer = "c1" },
                },
            };
        }

        [Fact]
        public void Only_the_new_element_is_positioned_never_the_placed_ones()
        {
            var result = AutoLayout.LayoutNewElements(DocAt(0, 0), new[] { "n" });

            Assert.Equal(new[] { "n" }, result.Positions.Keys.ToArray());
        }

        [Fact]
        public void A_new_element_goes_below_the_placed_box_it_is_wired_from()
        {
            var result = AutoLayout.LayoutNewElements(DocAt(0, 0), new[] { "n" });

            Assert.True(result.Positions["n"].Y > 400);
        }

        [Fact]
        public void A_diagram_the_user_dragged_far_away_is_followed()
        {
            var result = AutoLayout.LayoutNewElements(DocAt(5000, 3000), new[] { "n" });

            Assert.True(result.Positions["n"].X > 4000);
            Assert.True(result.Positions["n"].Y > 3400);
        }

        [Fact]
        public void A_new_element_never_lands_on_a_placed_box_of_another_layer()
        {
            var doc = DocAt(0, 0);
            var blocker = Fx.Element("blocker", layer: "other", x: 300, y: 700);
            doc = doc with { Elements = new Dictionary<string, CanvasElement>(doc.Elements) { ["blocker"] = blocker } };

            var result = AutoLayout.LayoutNewElements(doc, new[] { "n" });

            var p = result.Positions["n"];
            Assert.True(Math.Abs(p.X - 300) >= 300 || Math.Abs(p.Y - 700) >= 72);
        }

        [Fact]
        public void Fixed_positions_override_the_docs_for_kept_elements_about_to_be_restored()
        {
            var fixedPositions = new Dictionary<string, Position> { ["a"] = new(300, 2100), ["b"] = new(300, 2400) };

            var result = AutoLayout.LayoutNewElements(DocAt(0, 0), new[] { "n" }, fixedPositions);

            Assert.True(result.Positions["n"].Y > 2400);
        }
    }
}
