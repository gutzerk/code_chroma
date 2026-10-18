using System.Net;
using System.Text.Json;
using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests;

public class BranchBridgeTests
{
    private static BranchBridgeClient Client(HttpStatusCode status, string json) =>
        new(StubHandler.Client(_ => StubHandler.Json(status, json)));

    [Fact]
    public async Task Returns_the_new_workspace_record_when_the_bridge_opens_the_branch()
    {
        var outcome = await Client(HttpStatusCode.OK, """{"id":"br_x","branch":"x","worktree":"/w/br_x"}""")
            .RequestWorkspaceAsync("http://b", new BranchRequest.Existing("x"));

        Assert.Equal(new BranchOutcome.Opened(new("br_x", "x", "/w/br_x")), outcome);
    }

    [Theory]
    [InlineData(409, """{"detail":{"message":"branch 'x' is already open in main","workspace":"main"}}""", "held:main:branch 'x' is already open in main")]
    [InlineData(409, """{"detail":"'bad name' is not a valid branch name"}""", "failed:'bad name' is not a valid branch name")]
    [InlineData(500, """{}""", "failed:request failed (500)")]
    public async Task Refusals_are_held_or_failed_not_thrown(int status, string json, string expected)
    {
        var outcome = await Client((HttpStatusCode)status, json).RequestWorkspaceAsync("http://b", new BranchRequest.Existing("x"));

        Assert.Equal(expected, outcome switch
        {
            BranchOutcome.Held h => $"held:{h.Workspace}:{h.Message}",
            BranchOutcome.Failed f => $"failed:{f.Message}",
            _ => "opened",
        });
    }

    [Fact]
    public async Task A_new_branch_is_sent_as_new_branch_with_its_start_point()
    {
        string? sent = null;
        var client = new BranchBridgeClient(StubHandler.Client(request =>
        {
            sent = request.Content!.ReadAsStringAsync().Result;
            return StubHandler.Json(HttpStatusCode.OK, "{}");
        }));

        await client.RequestWorkspaceAsync("http://b", new BranchRequest.Create("task", "main"));

        using var body = JsonDocument.Parse(sent!);
        Assert.Equal(("task", "main"), (body.RootElement.GetProperty("new_branch").GetString(), body.RootElement.GetProperty("start_point").GetString()));
    }

    [Fact]
    public async Task A_network_failure_becomes_a_failed_outcome()
    {
        var client = new BranchBridgeClient(StubHandler.Client(_ => throw new HttpRequestException("connection refused")));

        var outcome = await client.RequestWorkspaceAsync("http://b", new BranchRequest.Existing("x"));

        Assert.Equal(new BranchOutcome.Failed("connection refused"), outcome);
    }

    [Fact]
    public async Task Lists_the_bridge_branches()
    {
        var choices = await Client(HttpStatusCode.OK, """{"current":"main","branches":[{"name":"main","open":true,"workspace":"main"}]}""").FetchChoicesAsync("http://b");

        Assert.Equal("main", choices.Current);
        Assert.Equal(new BranchChoice("main", true, "main"), Assert.Single(choices.Branches));
    }

    [Fact]
    public async Task Listing_throws_when_the_bridge_refuses()
    {
        var error = await Assert.ThrowsAsync<HttpRequestException>(() => Client(HttpStatusCode.InternalServerError, "{}").FetchChoicesAsync("http://b"));

        Assert.Contains("500", error.Message);
    }
}
