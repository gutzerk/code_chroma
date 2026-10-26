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
}
