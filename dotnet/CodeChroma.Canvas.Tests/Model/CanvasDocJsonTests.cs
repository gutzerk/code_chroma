namespace CodeChroma.Canvas.Tests.Model;

/// <summary>New coverage: the wire shape of GET /repos/{id}/canvas (canvas/document.py) that the web client only ever checked via TypeScript types.</summary>
public class CanvasDocJsonTests
{
    private const string Wire = """
    {
      "schema_version": 1, "doc_id": "doc-1", "updated_at": "2026-01-01T00:00:00Z",
      "elements": {
        "e1": {"id": "e1", "render": "epic", "layer": "epics", "label": "EP-1", "description": "d", "node_id": null,
               "position": {"x": 10.5, "y": 20}, "size": {"w": 300, "h": 72}, "group_id": "g1",
               "meta": {"recipe_key": "EP-1", "order": 2}, "created_by": "user", "style": {"color": "red"}},
        "e2": {"id": "e2", "render": "sequence", "layer": "sequence", "label": "", "description": "", "node_id": "n1",
               "position": {"x": 0, "y": 0}, "size": null, "group_id": null, "meta": {}, "created_by": "ai", "future_field": 1}
      },
      "edges": {
        "x1": {"id": "x1", "from": "e1", "to": "e2", "label": "calls", "kind": "uses", "layer": "c1",
               "transport": "https", "hero": true, "style": null, "origin": "a.py:3"}
      }
    }
    """;

    [Fact]
    public void Wire_json_round_trips_into_the_model()
    {
        var doc = CanvasDoc.FromJson(Wire);

        Assert.Equal(1, doc.SchemaVersion);
        Assert.Equal(RenderKind.Epic, doc.Elements["e1"].Render);
        Assert.Equal(new Position(10.5, 20), doc.Elements["e1"].Position);
        Assert.Equal(new Size(300, 72), doc.Elements["e1"].Size);
        Assert.Equal("g1", doc.Elements["e1"].GroupId);
        Assert.Null(doc.Elements["e2"].Size);
        Assert.Equal("n1", doc.Elements["e2"].NodeId);
        Assert.Equal("e2", doc.Edges["x1"].To);
        Assert.Equal("https", doc.Edges["x1"].Transport);
        Assert.True(doc.Edges["x1"].Hero);
    }

    [Fact]
    public void Unknown_fields_are_tolerated_so_a_newer_bridge_does_not_break_an_older_canvas()
    {
        var doc = CanvasDoc.FromJson(Wire);

        Assert.Equal(2, doc.Elements.Count);
    }

    [Fact]
    public void Meta_values_keep_their_json_type_for_string_number_and_flag_reads()
    {
        var doc = CanvasDoc.FromJson(Wire);

        Assert.Equal("EP-1", ElementMeta.String(doc.Elements["e1"], "recipe_key"));
        Assert.Equal("2", ElementMeta.Raw(doc.Elements["e1"], "order")?.ToString());
        Assert.Null(ElementMeta.String(doc.Elements["e1"], "order"));
    }

    [Fact]
    public void Serializing_and_reparsing_is_lossless()
    {
        var doc = CanvasDoc.FromJson(Wire);

        var again = CanvasDoc.FromJson(doc.ToJson());

        Assert.Equal(doc.Elements["e1"].Position, again.Elements["e1"].Position);
        Assert.Equal(doc.Edges["x1"].Origin, again.Edges["x1"].Origin);
        Assert.Equal("EP-1", ElementMeta.String(again.Elements["e1"], "recipe_key"));
    }

    [Theory]
    [InlineData("hierarchy", RenderKind.Hierarchy)]
    [InlineData("c1", RenderKind.C1)]
    [InlineData("pattern", RenderKind.Pattern)]
    [InlineData("impact", RenderKind.Impact)]
    [InlineData("epic", RenderKind.Epic)]
    [InlineData("spec", RenderKind.Spec)]
    [InlineData("task", RenderKind.Task)]
    [InlineData("custom", RenderKind.Custom)]
    [InlineData("group", RenderKind.Group)]
    [InlineData("note", RenderKind.Note)]
    [InlineData("sequence", RenderKind.Sequence)]
    public void Every_render_kind_the_bridge_allows_parses(string wire, RenderKind kind)
    {
        Assert.Equal(kind, ElementRules.ParseKind(wire));
    }
}
