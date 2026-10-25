using CodeChroma.Bridge.Questions;

namespace CodeChroma.Bridge.Tests.Questions;

/// <summary>Port of the pure parts of tests/unit/test_question_validation.py (contract, rejection text, tracker, diagram budget).</summary>
public class QuestionValidationTests
{
    private static QuestionOption Option(string id, int? rank = null, string? diagramRef = null, string description = "d", string pro = "p", string con = "c", string why = "w") =>
        new() { Id = id, Rank = rank, Title = "Option " + id, Description = description, Pro = pro, Con = con, Why = why, DiagramRef = diagramRef };

    private static AskRequest Request(List<QuestionOption>? options = null, string kind = "choices") =>
        new() { Question = "Which way?", Options = options ?? [Option("a", 1), Option("b", 2)], Kind = kind };

    [Fact]
    public void A_complete_question_has_no_problems() => Assert.Empty(QuestionValidation.Validate(Request()));

    [Theory]
    [InlineData("description")]
    [InlineData("pro")]
    [InlineData("con")]
    [InlineData("why")]
    public void An_option_missing_a_field_is_named(string missing)
    {
        var broken = Option("b", 2, description: missing == "description" ? "" : "d", pro: missing == "pro" ? "" : "p", con: missing == "con" ? "" : "c", why: missing == "why" ? "" : "w");

        var problems = QuestionValidation.Validate(Request([Option("a", 1), broken]));

        var problem = Assert.Single(problems);
        Assert.Contains($"missing {missing}", problem);
    }

    [Fact]
    public void An_option_missing_its_title_is_named_by_id()
    {
        var untitled = Option("b", 2);
        untitled.Title = "";

        var problem = Assert.Single(QuestionValidation.Validate(Request([Option("a", 1), untitled])));

        Assert.Equal("Option \"b\": missing title", problem);
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
    public void An_empty_question_is_reported()
    {
        var request = Request();
        request.Question = " ";

        Assert.Contains("question is empty", QuestionValidation.Validate(request));
    }

    [Fact]
    public void A_diagram_question_needs_one_diagram_ref() =>
        Assert.Contains(QuestionValidation.Validate(Request(kind: "diagram")), p => p.Contains("diagram_ref"));

    [Fact]
    public void A_diagram_question_with_a_ref_passes() =>
        Assert.Empty(QuestionValidation.Validate(Request([Option("a", 1, "x"), Option("b", 2)], "diagram")));

    [Fact]
    public void Unknown_diagram_refs_are_listed()
    {
        var request = Request([Option("a", 1, "nope"), Option("b", 2)]);

        Assert.Single(QuestionValidation.UnknownRefs(request, new HashSet<string> { "other" }));
        Assert.Empty(QuestionValidation.UnknownRefs(request, new HashSet<string> { "nope" }));
    }

    [Fact]
    public void Rejection_text_has_header_bullets_and_footer()
    {
        var lines = QuestionValidation.RejectionText(["Option \"B\": missing con", "exactly one option must have rank 1"]).Split('\n');

        Assert.Equal("CodeChroma rejected the question.", lines[0]);
        Assert.Equal(["- Option \"B\": missing con", "- exactly one option must have rank 1"], lines[1..3]);
        Assert.StartsWith("Call ask_user again with all fields.", lines[3]);
    }

    [Fact]
    public void The_tracker_counts_and_resets()
    {
        var tracker = new RejectionTracker();
        tracker.Record("w", "s");
        tracker.Record("w", "s");
        var counted = tracker.Count("w", "s");

        tracker.Reset("w", "s");

        Assert.Equal(2, counted);
        Assert.Equal(0, tracker.Count("w", "s"));
    }

    [Fact]
    public void The_tracker_forgets_after_ten_minutes_of_silence()
    {
        var now = 0.0;
        var tracker = new RejectionTracker(() => now);
        tracker.Record("w", "s");

        now = 601.0;

        Assert.Equal(0, tracker.Count("w", "s"));
    }

    [Fact]
    public void The_tracker_does_not_track_a_missing_session()
    {
        var tracker = new RejectionTracker();

        tracker.Record("w", null);

        Assert.Equal(0, tracker.Count("w", null));
    }

    [Fact]
    public void The_tracker_evicts_stale_entries_and_caps_its_size()
    {
        var now = 0.0;
        var tracker = new RejectionTracker(() => now, maxEntries: 2);
        tracker.Record("w", "old");
        now = 700.0;
        tracker.Record("w", "a");
        tracker.Record("w", "b");
        tracker.Record("w", "c");

        Assert.Equal(2, tracker.EntryCount);
        Assert.Equal(1, tracker.Count("w", "c"));
        Assert.Equal(0, tracker.Count("w", "old"));
    }

    private static DiagramNode Node(string id, string label = "", string description = "") => new(id, label.Length > 0 ? label : id, description);

    [Fact]
    public void A_diagram_within_budget_has_no_problems() =>
        Assert.Empty(OptionDiagrams.Validate([Node("x")], [], "A"));

    [Fact]
    public void A_diagram_over_the_node_budget_or_with_unknown_edges_is_reported()
    {
        var nodes = Enumerable.Range(0, OptionDiagrams.MaxNodes + 1).Select(i => Node(i.ToString(), "n")).ToList();

        var found = OptionDiagrams.Validate(nodes, [new DiagramEdge("0", "zz")], "A");

        Assert.Equal(2, found.Count);
    }

    [Theory]
    [InlineData("empty_title", "title is empty")]
    [InlineData("long_title", "title is longer than 80 characters")]
    [InlineData("long_id", "id is longer than 40 characters")]
    [InlineData("empty_id", "node with empty id")]
    [InlineData("long_label", "label is longer than 60 characters")]
    [InlineData("long_description", "description is longer than 300 characters")]
    [InlineData("self_loop", "self-loop")]
    [InlineData("duplicate_edge", "duplicate")]
    [InlineData("no_nodes", "give 1-12 nodes, got 0")]
    public void The_diagram_validator_reports_each_skill_checker_rule(string name, string expected)
    {
        var (title, nodes, edges) = Draft(name);

        var problems = OptionDiagrams.Validate(nodes, edges, title);

        Assert.Contains(problems, p => p.Contains(expected));
    }

    private static (string, List<DiagramNode>, List<DiagramEdge>) Draft(string name) => name switch
    {
        "empty_title" => (" ", [Node("a")], []),
        "long_title" => (new string('t', 81), [Node("a")], []),
        "long_id" => ("T", [Node(new string('a', 41))], []),
        "empty_id" => ("T", [Node(" ", "A")], []),
        "long_label" => ("T", [Node("a", new string('l', 61))], []),
        "long_description" => ("T", [Node("a", "A", new string('d', 301))], []),
        "self_loop" => ("T", [Node("a")], [new DiagramEdge("a", "a")]),
        "duplicate_edge" => ("T", [Node("a"), Node("b")], [new DiagramEdge("a", "b"), new DiagramEdge("a", "b")]),
        _ => ("T", [], []),
    };

    [Fact]
    public void Diagram_check_throws_the_tool_error_shape()
    {
        var error = Assert.Throws<QuestionRejected>(() => OptionDiagrams.Check([Node("a")], [], " "));

        Assert.StartsWith("CodeChroma rejected the diagram.", error.Message);
    }
}
