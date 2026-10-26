using System.Text.Json.Nodes;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Tests.Questions;

public class QuestionDeliveryTests
{
    private static CanvasElement Element(string state, string? answer = null, bool revised = false, int? total = 3, string label = "How to structure checkout?")
    {
        var meta = new JsonObject
        {
            ["question_id"] = "q1", ["step"] = 2, ["total"] = total, ["state"] = state, ["answer"] = answer, ["agent_id"] = "agent-1",
        };
        if (revised) meta["revised"] = true;
        return new CanvasElement { Render = "question", Label = label, Meta = meta };
    }

    [Fact]
    public void An_answer_reads_as_question_arrow_answer_with_its_step()
    {
        var text = QuestionDelivery.AnswerMessage(Element("answered", "Modular monolith"));

        Assert.Equal("[CodeChroma answer · Q2/3 · q1] How to structure checkout? → Modular monolith", text);
    }

    [Fact]
    public void A_skip_tells_the_agent_to_decide_itself()
    {
        var text = QuestionDelivery.AnswerMessage(Element("skipped"));

        Assert.Equal("[CodeChroma answer · Q2/3 · q1] How to structure checkout? → skipped by the user, decide yourself", text);
    }

    [Fact]
    public void A_re_answer_after_a_revise_says_changed_answer()
    {
        var text = QuestionDelivery.AnswerMessage(Element("answered", "Microservices", revised: true));

        Assert.EndsWith("→ changed answer: Microservices", text);
    }

    [Fact]
    public void A_question_without_a_total_omits_it_and_control_characters_collapse_to_one_line()
    {
        var text = QuestionDelivery.AnswerMessage(Element("answered", "a\nb\r\tc", total: null, label: "multi\nline"));

        Assert.Equal("[CodeChroma answer · Q2 · q1] multi line → a b c", text);
    }

    [Fact]
    public void A_diagram_request_names_the_question_and_the_tool_to_use()
    {
        var text = QuestionDelivery.DiagramRequestMessage(Element("open"));

        Assert.StartsWith("[CodeChroma request · Q2/3 · q1] How to structure checkout? → the user wants a diagram", text);
        Assert.Contains("draw_option_diagram", text);
    }

    [Fact]
    public void Deliver_types_the_text_into_the_live_session_of_the_asking_agent()
    {
        var typed = new List<string>();

        var delivered = QuestionDelivery.Deliver("agent-1", id => id == "agent-1" ? t => { typed.Add(t); return Task.CompletedTask; } : null, "hello");

        Assert.True(delivered);
        Assert.Equal(["hello"], typed);
    }

    [Fact]
    public void Deliver_reports_false_without_an_agent_or_a_live_session()
    {
        var noAgent = QuestionDelivery.Deliver(null, _ => _ => Task.CompletedTask, "x");
        var noSession = QuestionDelivery.Deliver("gone", _ => null, "x");

        Assert.False(noAgent);
        Assert.False(noSession);
    }
}
