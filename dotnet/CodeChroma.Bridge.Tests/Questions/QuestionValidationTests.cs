using CodeChroma.Bridge.Questions;
using static CodeChroma.Bridge.Tests.Questions.QuestionTestKit;

namespace CodeChroma.Bridge.Tests.Questions;

/// <summary>The `ask_user` contract: each rule, the rejection text, the retry counter and the diagram budget.</summary>
public sealed class QuestionValidationTests
{
    private static List<QuestionOption> Pair() => [Option("a", 1), Option("b", 2)];

    [Fact]
    public void A_complete_question_has_no_problems() => Assert.Empty(QuestionValidation.Validate(Request(Pair())));

    [Theory]
    [InlineData("description")]
    [InlineData("pro")]
    [InlineData("con")]
    [InlineData("why")]
    [InlineData("title")]
    public void An_option_missing_a_field_is_named(string missing)
    {
        var broken = Option("b", 2, description: missing == "description" ? "" : "d", pro: missing == "pro" ? "" : "p", con: missing == "con" ? "" : "c", why: missing == "why" ? "" : "w");
        if (missing == "title") broken.Title = "";

        var problems = QuestionValidation.Validate(Request([Option("a", 1), broken]));

        var problem = Assert.Single(problems);
        Assert.Contains($"missing {missing}", problem);
    }

    [Fact]
    public void No_rank_one_is_reported() =>
        Assert.Contains("exactly one option must have rank 1", QuestionValidation.Validate(Request([Option("a", 2), Option("b", 3)])));

    [Fact]
    public void Two_rank_ones_are_reported()
    {
        var problems = QuestionValidation.Validate(Request([Option("a", 1), Option("b", 1)]));

        Assert.Contains("exactly one option must have rank 1", problems);
        Assert.Contains("ranks are not unique", problems);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(5)]
    public void Option_count_outside_two_to_four_is_reported(int count)
    {
        var options = Enumerable.Range(0, count).Select(i => Option(i.ToString(), i == 0 ? 1 : i + 1)).ToList();

        Assert.Contains(QuestionValidation.Validate(Request(options)), p => p.Contains("2-4 options"));
    }

    [Fact]
    public void Duplicate_option_ids_are_reported() =>
        Assert.Contains("option ids are not unique", QuestionValidation.Validate(Request([Option("a", 1), Option("a", 2)])));

    [Fact]
    public void An_empty_question_is_reported() =>
        Assert.Contains("question is empty", QuestionValidation.Validate(Request(Pair(), question: " ")));

    [Fact]
    public void A_diagram_question_needs_one_diagram_ref() =>
        Assert.Contains(QuestionValidation.Validate(Request(Pair(), kind: "diagram")), p => p.Contains("diagram_ref"));

    [Fact]
    public void A_diagram_question_with_a_ref_passes() =>
        Assert.Empty(QuestionValidation.Validate(Request([Option("a", 1, diagramRef: "x"), Option("b", 2)], kind: "diagram")));

    [Fact]
    public void Unknown_diagram_refs_are_listed()
    {
        var request = Request([Option("a", 1, diagramRef: "nope"), Option("b", 2)]);

        Assert.Single(QuestionValidation.UnknownRefs(request, ["other"]));
        Assert.Empty(QuestionValidation.UnknownRefs(request, ["nope"]));
    }

    [Fact]
    public void Rejection_text_has_header_bullets_and_footer()
    {
        var text = QuestionValidation.RejectionText(["Option \"B\": missing con", "exactly one option must have rank 1"]);

        var lines = text.Split('\n');
        Assert.Equal("CodeChroma rejected the question.", lines[0]);
        Assert.Equal(["- Option \"B\": missing con", "- exactly one option must have rank 1"], lines[1..3]);
        Assert.StartsWith("Call ask_user again with all fields.", lines[3]);
    }

    [Fact]
    public void Tracker_counts_rejections()
    {
        var tracker = new RejectionTracker();
        tracker.Record("w", "s");
        tracker.Record("w", "s");

        Assert.Equal(2, tracker.Count("w", "s"));
    }

    [Fact]
    public void Tracker_reset_forgets_the_count()
    {
        var tracker = new RejectionTracker();
        tracker.Record("w", "s");

        tracker.Reset("w", "s");

        Assert.Equal(0, tracker.Count("w", "s"));
    }

    [Fact]
    public void Tracker_forgets_after_ten_minutes_of_silence()
    {
        var now = 0.0;
        var tracker = new RejectionTracker(() => now);
        tracker.Record("w", "s");

        now = 601.0;

        Assert.Equal(0, tracker.Count("w", "s"));
    }

    [Fact]
    public void Tracker_does_not_track_a_missing_session()
    {
        var tracker = new RejectionTracker();

        tracker.Record("w", null);

        Assert.Equal(0, tracker.Count("w", null));
    }

    [Fact]
    public void Tracker_evicts_stale_entries_and_caps_size()
    {
        var now = 0.0;
        var tracker = new RejectionTracker(() => now, maxEntries: 2);
        tracker.Record("w", "old");
        now = 700.0;
        tracker.Record("w", "a");
        tracker.Record("w", "b");
        tracker.Record("w", "c");

        Assert.Equal(2, tracker.Size);
        Assert.Equal(1, tracker.Count("w", "c"));
        Assert.Equal(0, tracker.Count("w", "old"));
    }

    private static DiagramNode Node(string id, string? label = null, string description = "", string? status = null) => new(id, label ?? id, description, status);

    [Fact]
    public void A_draft_within_budget_has_no_problems() =>
        Assert.Empty(QuestionDiagrams.Validate([Node("x")], [], "A"));

    [Fact]
    public void A_draft_reports_budget_and_unknown_edges()
    {
        var nodes = Enumerable.Range(0, QuestionDiagrams.MaxNodes + 1).Select(i => Node(i.ToString(), "n")).ToList();

        var found = QuestionDiagrams.Validate(nodes, [new DiagramEdge("0", "zz")], "A");

        Assert.Equal(2, found.Count);
    }

    [Theory]
    [InlineData("empty title", " ", "a", "A", 0, "title is empty")]
    [InlineData("long title", "t", "a", "A", 0, "title is longer than 80 characters")]
    [InlineData("empty id", "T", " ", "A", 0, "node with empty id")]
    [InlineData("empty label", "T", "a", " ", 0, "node \"a\": empty label")]
    [InlineData("long label", "T", "a", "l", 0, "label is longer than 60 characters")]
    [InlineData("long description", "T", "a", "A", 301, "description is longer than 300 characters")]
    public void Each_diagram_length_rule_is_reported(string name, string title, string id, string label, int descriptionLength, string expected)
    {
        var longTitle = name == "long title" ? new string('t', 81) : title;
        var longLabel = name == "long label" ? new string('l', 61) : label;

        var found = QuestionDiagrams.Validate([Node(id, longLabel, new string('d', descriptionLength))], [], longTitle);

        Assert.Contains(found, p => p.Contains(expected));
    }

    [Fact]
    public void Edges_with_self_loops_and_duplicates_are_reported()
    {
        var nodes = new[] { Node("a"), Node("b") };

        var found = QuestionDiagrams.Validate(nodes, [new DiagramEdge("a", "a"), new DiagramEdge("a", "b"), new DiagramEdge("a", "b")], "T");

        Assert.Equal(["edge a->a: self-loop", "edge a->b: duplicate"], found);
    }

    [Fact]
    public void An_empty_node_list_and_duplicate_ids_are_reported()
    {
        Assert.Equal(["give 1-12 nodes, got 0"], QuestionDiagrams.Validate([], [], "T"));
        Assert.Contains("node ids are not unique", QuestionDiagrams.Validate([Node("a"), Node("a", "")], [], "T"));
    }
}
