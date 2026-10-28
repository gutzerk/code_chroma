using System.Net;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Tests.Support;
using static CodeChroma.Bridge.Tests.Questions.QuestionTestKit;

namespace CodeChroma.Bridge.Tests.Questions;

public class QuestionConcurrencyTests
{
    [Fact]
    public async Task An_answer_before_a_diagram_reask_keeps_its_options_and_result()
    {
        using var host = new BridgeHost();
        var ws = Main(host);
        var mcp = Mcp(host);
        var questionId = Open(host, Request(sessionId: "session"));
        QuestionStore.RequestDiagram(ws, QuestionStore.FindElement(ws, questionId)!, "now");
        Task<JsonObject> reask;
        lock (CanvasWrite.LockFor(ws.Id))
        {
            reask = mcp.Ask("main", Request([Option("c", 1), Option("d", 2)], sessionId: "session"));
            // Let the re-ask reach the write lock while the user's answer owns it.
            Thread.Sleep(300);
            QuestionStore.Settle(ws, QuestionStore.FindElement(ws, questionId)!.Id, "answered", new QuestionResult { Answer = "Modular monolith", OptionId = "a" });
        }
        var asked = await reask.WaitAsync(TimeSpan.FromSeconds(30));
        var saved = QuestionStore.FindElement(ws, questionId)!;
        var polled = await mcp.Result("main", questionId);

        Assert.Equal("answered", (string?)saved.Meta["state"]);
        Assert.Equal(new[] { "a", "b" }, saved.Meta["options"]!.AsArray().Select(o => (string?)o!["id"]));
        Assert.Equal("a", (string?)polled["option_id"]);
        Assert.True((bool)asked["asked"]!);
        Assert.NotEqual(questionId, (string?)asked["question_id"]);
    }

    [Theory]
    [InlineData("answer")]
    [InlineData("skip")]
    public async Task Competing_decisions_settle_once_and_the_result_matches_the_element(string competingAction)
    {
        using var host = new BridgeHost();
        var questionId = Open(host, Request());
        var mcp = Mcp(host);
        Task<HttpResponseMessage> first;
        Task<HttpResponseMessage> second;
        lock (CanvasWrite.LockFor("main"))
        {
            first = host.Client.PostAsync($"/repos/main/questions/{questionId}/answer", JsonBody(new JsonObject { ["option_id"] = "a" }));
            second = host.Client.PostAsync($"/repos/main/questions/{questionId}/{competingAction}", JsonBody(new JsonObject { ["option_id"] = "b" }));
            // Hold the write lock while both requests arrive, exposing a state check outside the lock.
            Thread.Sleep(300);
        }
        var responses = await Task.WhenAll(first, second).WaitAsync(TimeSpan.FromSeconds(30));
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Conflict);
        var saved = QuestionStore.ResultFrom(QuestionStore.FindElement(Main(host), questionId)!)!.ToToolJson();
        Assert.True(JsonNode.DeepEquals(saved, await mcp.Result("main", questionId)));
    }
}
