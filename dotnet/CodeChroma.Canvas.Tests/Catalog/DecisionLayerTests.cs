using CodeChroma.Canvas.Scene;
namespace CodeChroma.Canvas.Tests.Catalog;

public class DecisionLayerTests
{
    [Theory]
    [InlineData("decisions/q1", true)]
    [InlineData("decisions/draft-ab12", true)]
    [InlineData("decisions", false)]
    [InlineData("questions", false)]
    [InlineData("default", false)]
    [InlineData("c1", true)]
    public void Only_per_question_decisions_layers_count_as_diagrams(string layer, bool expected)
    {
        var isDiagram = DiagramCatalog.IsDiagramLayer(layer);

        Assert.Equal(expected, isDiagram);
    }

    [Fact]
    public void A_per_question_layer_has_no_recipe_and_no_artifact_to_delete()
    {
        var recipeBacked = DiagramCatalog.IsRecipeBackedLayer("decisions/q1");
        var deletable = DiagramCatalog.HasDeletableDiagramArtifact("decisions/q1");

        Assert.False(recipeBacked);
        Assert.False(deletable);
    }

    [Fact]
    public void Option_diagram_layers_are_never_listed_as_active_diagrams()
    {
        var doc = Fx.DocOf(Fx.Element("a"), Fx.Element("b", layer: "decisions/q1", render: RenderKind.Custom), Fx.Element("c", layer: "decisions", render: RenderKind.Custom));

        var layers = DiagramCatalog.ListActiveDiagramLayers(doc);

        Assert.Equal(["c1"], layers);
    }

    [Fact]
    public void The_scene_never_holds_a_question_card_or_an_option_diagram()
    {
        var doc = Fx.DocOf(Fx.Element("a"), Fx.Element("q", layer: "questions", render: RenderKind.Note), Fx.Element("d", layer: "decisions/draft-ab", render: RenderKind.Group), Fx.Element("o", layer: "decisions", render: RenderKind.Custom));

        var scene = new SceneGraph(doc);

        Assert.Equal(["a"], scene.Nodes.Select(n => n.Id));
        Assert.True(scene.Contains("a"));
        Assert.False(scene.Contains("d"));
    }
}
