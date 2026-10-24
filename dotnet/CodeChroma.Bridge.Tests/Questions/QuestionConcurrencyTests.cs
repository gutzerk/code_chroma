using System.Net;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Tests.Support;
using static CodeChroma.Bridge.Tests.Questions.QuestionTestKit;

namespace CodeChroma.Bridge.Tests.Questions;

public class QuestionConcurrencyTests
{
    [Theory]
    [InlineData("answer")]
    [InlineData("skip")]
    public async Task Competing_decisions_settle_once_and_match_the_waiting_agent(string competingAction)
    {
        using var host = new BridgeHost();
        var questionId = Open(host, Request());
        var mcp = Mcp(host);
        mcp.Broker.Open(questionId);
        var waiting = mcp.Broker.Wait(questionId, TimeSpan.FromSeconds(5));
        Task<HttpResponseMessage> first;
        Task<HttpResponseMessage> second;
        lock (CanvasWrite.LockFor("main"))
        {
            first = host.Client.PostAsync($"/repos/main/questions/{questionId}/answer", JsonBody(new JsonObject { ["option_id"] = "a" }));
            second = host.Client.PostAsync($"/repos/main/questions/{questionId}/{competingAction}", JsonBody(new JsonObject { ["option_id"] = "b" }));
            // Hold the write lock while both requests arrive, exposing a state check outside the lock.
            Thread.Sleep(300);
        }
        var responses = await Task.WhenAll(first, second).WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.OK);
        Assert.Single(responses, r => r.StatusCode == HttpStatusCode.Conflict);
        var delivered = (await waiting).ToToolJson();
        var saved = QuestionStore.ResultFrom(QuestionStore.FindElement(Main(host), questionId)!)!.ToToolJson();
        Assert.True(JsonNode.DeepEquals(delivered, saved));
        Assert.True(JsonNode.DeepEquals(delivered, await mcp.Result("main", questionId)));
    }
}
