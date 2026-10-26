using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Tests.Support;
using static CodeChroma.Bridge.Tests.Questions.QuestionTestKit;

namespace CodeChroma.Bridge.Tests.Questions;

public class QuestionDiagramLayoutTests
{
    private static readonly DiagramNode[] Five = [new("a", "A"), new("b", "B"), new("c", "C"), new("d", "D"), new("e", "E")];

    private static CanvasDoc Draw(BridgeHost host, string? questionId = null, string? optionId = null)
    {
        QuestionStore.DrawDiagram(Main(host), "T", Five, [new DiagramEdge("a", "b")], questionId, optionId);
        return CanvasDoc.Load(Main(host).CanvasCorePath(), Main(host).DiagramsRoot());
    }

    private static bool IsRoot(CanvasElement e) => e.Meta["diagram_root"] is not null;

    [Fact]
    public void Positions_are_centres_and_the_root_wraps_its_nodes()
    {
        using var host = new BridgeHost();

        var doc = Draw(host);

        var root = doc.Elements.Values.Single(IsRoot);
        var members = doc.Elements.Values.Where(e => e.GroupId == root.Id).ToList();
        Assert.Equal(new[] { 4 * 200 - 200 + 160 + 40.0, 100 + 60 + 40 + 20.0 }, new[] { root.Size!.W, root.Size.H });
        Assert.Equal(root.Size.W / 2, root.Position.X);
        Assert.All(members, m => Assert.InRange(m.Position.X - m.Size!.W / 2, root.Position.X - root.Size.W / 2, root.Position.X + root.Size.W / 2));
        Assert.All(members, m => Assert.InRange(m.Position.Y + m.Size!.H / 2, root.Position.Y - root.Size.H / 2, root.Position.Y + root.Size.H / 2));
    }

    [Fact]
    public void A_diagram_without_a_question_goes_on_a_draft_layer_below_decisions()
    {
        using var host = new BridgeHost();

        var doc = Draw(host);

        Assert.All(doc.Elements.Values, e => Assert.StartsWith("decisions/draft-", e.Layer));
        Assert.All(doc.Edges.Values, e => Assert.StartsWith("decisions/draft-", e.Layer));
    }

    [Fact]
    public void A_diagram_for_a_question_option_uses_that_questions_layer()
    {
        using var host = new BridgeHost();
        var questionId = Open(host, Request());

        var doc = Draw(host, questionId, "a");

        Assert.All(doc.Elements.Values.Where(e => e.Render != "question"), e => Assert.Equal($"decisions/{questionId}", e.Layer));
    }

    [Fact]
    public void A_new_diagram_starts_below_the_lowest_existing_decisions_element_with_a_gap()
    {
        using var host = new BridgeHost();
        var first = Draw(host);
        var bottom = first.Elements.Values.Max(e => e.Position.Y + (e.Size?.H ?? 0) / 2);

        var second = Draw(host);

        var roots = second.Elements.Values.Where(IsRoot).OrderBy(e => e.Position.Y).ToList();
        Assert.Equal(bottom + QuestionDiagrams.Gap, roots[1].Position.Y - roots[1].Size!.H / 2);
    }

    [Fact]
    public async Task Asking_with_a_drawn_diagram_ref_moves_the_draft_diagram_onto_the_question_layer()
    {
        using var host = new BridgeHost();
        var root = Draw(host).Elements.Values.Single(IsRoot);

        var asked = await Mcp(host).Ask("main", Request([Option("a", 1, diagramRef: root.Id), Option("b", 2)], kind: "diagram"));

        var after = CanvasDoc.Load(Main(host).CanvasCorePath(), Main(host).DiagramsRoot());
        var layer = $"decisions/{(string)asked["question_id"]!}";
        Assert.All(after.Elements.Values.Where(e => e.Render != "question"), e => Assert.Equal(layer, e.Layer));
        Assert.All(after.Edges.Values, e => Assert.Equal(layer, e.Layer));
    }

    [Fact]
    public void Decisions_layers_write_no_projection_file()
    {
        using var host = new BridgeHost();
        var questionId = Open(host, Request());

        Draw(host, questionId, "a");

        var root = Main(host).DiagramsRoot();
        var projections = Directory.Exists(root) ? Directory.EnumerateFiles(root, "projection.json", SearchOption.AllDirectories) : [];
        Assert.DoesNotContain(projections, p => p.Contains("decisions"));
    }

    [Fact]
    public void A_diagram_with_mostly_undescribed_nodes_warns_softly()
    {
        var warning = QuestionDiagrams.DescriptionWarning([new("a", "A"), new("b", "B"), new("c", "C", "described")]);
        var fine = QuestionDiagrams.DescriptionWarning([new("a", "A", "x"), new("b", "B", "y")]);

        Assert.Equal(QuestionDiagrams.MissingDescriptions, warning);
        Assert.Null(fine);
    }
}
