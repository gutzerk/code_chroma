using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Tests.Support;
using static CodeChroma.Bridge.Tests.Questions.QuestionTestKit;

namespace CodeChroma.Bridge.Tests.Questions;

/// <summary>The wake-up after the last open question of an agent settles, and the canvas cleanup that comes with it.</summary>
public class QuestionBatchDeliveryTests
{
    private sealed class Terminals
    {
        public List<(string Agent, string Text)> Typed { get; } = [];

        public Func<string, Func<string, Task>?> Live(params string[] agents) =>
            id => agents.Contains(id) ? text => { Typed.Add((id, text)); return Task.CompletedTask; } : null;
    }

    private static string Ask(BridgeHost host, string agent, string question = "How to structure checkout?", List<QuestionOption>? options = null)
    {
        var request = Request(options, question);
        request.AgentId = agent;
        return Open(host, request);
    }

    private static bool Settle(BridgeHost host, string questionId, Func<string, Func<string, Task>?> injector, string? optionId = "a")
    {
        var ws = Main(host);
        var element = QuestionStore.FindElement(ws, questionId)!;
        var result = optionId is null ? new QuestionResult { Skipped = true } : new QuestionResult { Answer = "Option " + optionId, OptionId = optionId };
        QuestionStore.Settle(ws, element.Id, optionId is null ? "skipped" : "answered", result);
        return QuestionDelivery.DeliverSettled(ws, QuestionStore.FindElement(ws, questionId)!, injector);
    }

    [Fact]
    public void Nothing_is_typed_while_another_question_of_the_same_agent_is_open()
    {
        using var host = new BridgeHost();
        var terminals = new Terminals();
        var first = Ask(host, "agent-1");
        Ask(host, "agent-1", "Which store?");

        var waiting = Settle(host, first, terminals.Live("agent-1"));

        Assert.True(waiting);
        Assert.Empty(terminals.Typed);
        Assert.Equal(2, QuestionStore.ListQuestions(Main(host)).Count);
    }

    [Fact]
    public void Settling_the_last_question_types_every_answer_once_into_the_asking_agent()
    {
        using var host = new BridgeHost();
        var terminals = new Terminals();
        var first = Ask(host, "agent-1");
        var second = Ask(host, "agent-1", "Which store?");
        Settle(host, first, terminals.Live("agent-1"));

        Settle(host, second, terminals.Live("agent-1"), optionId: null);
        var again = QuestionDelivery.DeliverSettled(Main(host), new CanvasElement { Render = "question", Meta = new() { ["agent_id"] = "agent-1" } }, terminals.Live("agent-1"));

        var (agent, text) = Assert.Single(terminals.Typed);
        Assert.Equal("agent-1", agent);
        Assert.Equal(
            $"[CodeChroma answer · Q1 · {first}] How to structure checkout? → Option a [CodeChroma answer · Q1 · {second}] Which store? → skipped by the user, decide yourself",
            text);
        Assert.True(again);
    }

    [Fact]
    public void Another_agents_open_question_neither_blocks_nor_receives_the_wake_up()
    {
        using var host = new BridgeHost();
        var terminals = new Terminals();
        var mine = Ask(host, "agent-1");
        var theirs = Ask(host, "agent-2", "Which store?");

        Settle(host, mine, terminals.Live("agent-1", "agent-2"));

        Assert.Equal(["agent-1"], terminals.Typed.Select(t => t.Agent));
        Assert.Equal([theirs], QuestionStore.ListQuestions(Main(host)).Select(e => (string?)e.Meta["question_id"]));
    }

    [Fact]
    public void A_completed_batch_leaves_no_question_or_option_diagram_on_the_canvas()
    {
        using var host = new BridgeHost();
        var ws = Main(host);
        DiagramNode[] nodes = [new("api", "API", "d"), new("db", "DB", "d")];
        var draft = QuestionStore.DrawDiagram(ws, "Draft", nodes, [new DiagramEdge("api", "db")], null, null);
        var questionId = Ask(host, "agent-1", options: [Option("a", 1, diagramRef: draft), Option("b", 2)]);
        QuestionStore.DrawDiagram(ws, "Attached", nodes, [new DiagramEdge("api", "db")], questionId, "b");
        var unrelated = QuestionStore.DrawDiagram(ws, "Other draft", nodes, [], null, null);

        Settle(host, questionId, new Terminals().Live("agent-1"));

        var doc = CanvasDoc.Load(ws.CanvasCorePath(), ws.DiagramsRoot());
        Assert.DoesNotContain(doc.Elements.Values, e => e.Render == "question");
        Assert.DoesNotContain(doc.Elements.Values, e => e.Layer == QuestionDiagrams.LayerFor(questionId, ""));
        Assert.DoesNotContain(doc.Edges.Values, e => e.Layer.StartsWith(QuestionDiagrams.LayerPrefix, StringComparison.Ordinal) && !QuestionDiagrams.IsDraftLayer(e.Layer));
        Assert.Contains(unrelated, doc.Elements.Keys);
    }

    [Fact]
    public void A_session_keeps_counting_steps_after_its_answered_batch_is_cleared()
    {
        using var host = new BridgeHost();
        var first = Request(sessionId: "s1", total: 3);
        first.AgentId = "agent-1";
        Settle(host, Open(host, first), new Terminals().Live("agent-1"));
        var second = Request(question: "Which store?", sessionId: "s1", total: 3);
        second.AgentId = "agent-1";

        var questionId = Open(host, second);

        Assert.Equal(2, (int)QuestionStore.FindElement(Main(host), questionId)!.Meta["step"]!);
    }

    [Fact]
    public void Without_a_live_session_the_answer_stays_on_the_canvas_for_ask_user_result()
    {
        using var host = new BridgeHost();
        var questionId = Ask(host, "gone");

        var waiting = Settle(host, questionId, new Terminals().Live());

        Assert.False(waiting);
        Assert.Equal("answered", (string?)QuestionStore.FindElement(Main(host), questionId)!.Meta["state"]);
    }

    [Fact]
    public async Task Typed_text_and_its_Enter_are_separate_writes_so_the_agent_submits_instead_of_pasting()
    {
        var writes = new List<string>();

        await AgentSession.TypeAndSubmit(writes.Add, "[CodeChroma answer · Q1 · q1] Pick? → A", TimeSpan.Zero);

        Assert.Equal(["[CodeChroma answer · Q1 · q1] Pick? → A", "\r"], writes);
    }
}
