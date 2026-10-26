using System.Text.Json.Nodes;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Workspaces;
using Microsoft.Extensions.DependencyInjection;
using static CodeChroma.Bridge.Tests.Questions.QuestionTestKit;

namespace CodeChroma.Bridge.Tests.Questions;

public class QuestionResultScopeTests
{
    [Theory]
    [InlineData("answer")]
    [InlineData("skip")]
    [InlineData("request-diagram")]
    public async Task Cached_results_are_only_returned_for_a_question_in_the_authenticated_workspace(string action)
    {
        using var host = new BridgeHost();
        var mcp = Mcp(host);
        var otherRoot = Path.Combine(host.Root, "other");
        Directory.CreateDirectory(otherRoot);
        host.Factory.Services.GetRequiredService<WorkspaceRegistry>().Register("other", otherRoot);
        var questionId = Open(host, Request());
        var settled = await host.Client.PostAsync($"/repos/main/questions/{questionId}/{action}", JsonBody(new JsonObject { ["option_id"] = "a" }));
        settled.EnsureSuccessStatusCode();
        var call = new JsonObject
        {
            ["jsonrpc"] = "2.0", ["id"] = 1, ["method"] = "tools/call",
            ["params"] = new JsonObject { ["name"] = "ask_user_result", ["arguments"] = new JsonObject { ["question_id"] = questionId } },
        };

        var foreign = await mcp.HandleMcp("Bearer " + mcp.TokenFor("other"), call);
        var owner = await mcp.HandleMcp("Bearer " + mcp.TokenFor("main"), call);

        Assert.True((bool)foreign!["result"]!["structuredContent"]!["pending"]!);
        Assert.Null(foreign["result"]!["structuredContent"]!["answer"]);
        var expected = (QuestionStore.ResultFrom(QuestionStore.FindElement(CodeChroma.Bridge.Tests.Questions.QuestionTestKit.Main(host), questionId)!) ?? new QuestionResult { Pending = true, QuestionId = questionId }).ToToolJson();
        Assert.True(JsonNode.DeepEquals(expected, owner!["result"]!["structuredContent"]));
    }
}
