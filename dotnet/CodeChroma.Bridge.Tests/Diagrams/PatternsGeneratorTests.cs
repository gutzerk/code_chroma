using CodeChroma.Bridge.Diagrams;
using CodeChroma.Bridge.Skills;
using CodeChroma.Core.Patterns;

namespace CodeChroma.Bridge.Tests.Diagrams;

public class PatternsGeneratorTests
{
    private sealed class StubLlm(string reply) : ILlmCompletion
    {
        public Task<string> Complete(string user, string model, int maxTokens, string? system = null) => Task.FromResult(reply);
    }

    private static PatternInstance Candidate(string id) => new(
        id, PatternType.Strategy, "Pay", 0.8,
        [new PatternParticipant(id + "-p", PatternRole.Interface, "Pay", "m.Pay", "n1", "m.py", "d")],
        [new PatternRelation(id + "-p", id + "-p", PatternRelationKind.Uses)]);

    [Fact]
    public async Task No_candidates_returns_null()
    {
        var result = await PatternsGenerator.Generate([], new StubLlm("{}"), "m");

        Assert.Null(result);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("{\"confirmations\":\"x\"}")]
    [InlineData("{\"confirmations\":[{\"id\":\"other\",\"confirmed\":true}]}")]
    public async Task A_bad_reply_or_no_match_returns_null(string reply)
    {
        var result = await PatternsGenerator.Generate([Candidate("a")], new StubLlm(reply), "m");

        Assert.Null(result);
    }

    [Fact]
    public async Task A_confirmation_merges_name_and_description_onto_the_real_participants()
    {
        var reply = "{\"confirmations\":[{\"id\":\"a\",\"confirmed\":true,\"name\":\"Named\",\"description\":\"Why.\"}]}";

        var result = await PatternsGenerator.Generate([Candidate("a")], new StubLlm(reply), "m");

        Assert.Equal("patterns", (string?)result!["type"]);
        Assert.Equal("Named", (string?)result["nodes"]![0]!["name"]);
        Assert.Equal("a-p", (string?)result["nodes"]![1]!["id"]);
        Assert.Equal("a", (string?)result["nodes"]![1]!["parent"]);
        Assert.Single(result["relations"]!.AsArray());
    }

    private sealed class TimeoutLlm : ILlmCompletion
    {
        public Task<string> Complete(string user, string model, int maxTokens, string? system = null) => throw new TaskCanceledException();
    }

    [Fact]
    public async Task A_provider_timeout_yields_null_instead_of_throwing()
    {
        var result = await PatternsGenerator.Generate([Candidate("a")], new TimeoutLlm(), "m");

        Assert.Null(result);
    }

    [Fact]
    public async Task A_markdown_fenced_reply_is_still_parsed()
    {
        var reply = "```json\n{\"confirmations\":[{\"id\":\"a\",\"confirmed\":true,\"name\":\"N\",\"description\":\"D\"}]}\n```";

        var result = await PatternsGenerator.Generate([Candidate("a")], new StubLlm(reply), "m");

        Assert.NotNull(result);
    }
}
