using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Tests.Stores;

public class CliModelProbeTests
{
    [Fact]
    public void Claude_control_response_lists_models_by_value_and_display_name()
    {
        var line = """{"type":"control_response","response":{"subtype":"success","request_id":"models","response":{"models":[{"value":"default","displayName":"Default (recommended)"},{"value":"fable","displayName":"Fable 5.1"}]}}}""";

        var models = CliModelProbe.ParseClaudeResponse(line);

        Assert.Equal(["default", "fable"], models!.Select(m => (string)m!["id"]!));
        Assert.Equal("Fable 5.1", (string)models![1]!["label"]!);
    }

    [Theory]
    [InlineData("""{"type":"system","subtype":"init"}""")]
    [InlineData("""{"type":"control_response","response":{"request_id":"other","response":{"models":[{"value":"x"}]}}}""")]
    [InlineData("not json")]
    public void Claude_ignores_lines_that_are_not_the_models_response(string line)
    {
        var models = CliModelProbe.ParseClaudeResponse(line);

        Assert.Null(models);
    }

    [Theory]
    [InlineData("""{"models":[{"slug":"gpt-5.2-codex","display_name":"GPT-5.2 Codex"}]}""")]
    [InlineData("""[{"slug":"gpt-5.2-codex","display_name":"GPT-5.2 Codex"}]""")]
    public void Codex_model_list_is_read_from_object_or_bare_array(string json)
    {
        var models = CliModelProbe.ParseModelList(json);

        Assert.Equal("gpt-5.2-codex", (string)models![0]!["id"]!);
        Assert.Equal("GPT-5.2 Codex", (string)models![0]!["label"]!);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("true")]
    [InlineData("42")]
    [InlineData("\"Unknown command\"")]
    public void Scalar_model_list_is_null(string json)
    {
        var models = CliModelProbe.ParseModelList(json);

        Assert.Null(models);
    }

    [Fact]
    public void Unparseable_model_list_is_null()
    {
        var models = CliModelProbe.ParseModelList("oops");

        Assert.Null(models);
    }

    private static readonly JsonNode ProbeCases = JsonNode.Parse(
        File.ReadAllText(Path.Combine(Contract.ContractCases.FixtureDir, "cli_model_probe.json")))!;

    [Theory]
    [InlineData("codex")]
    [InlineData("gemini")]
    public void Listing_command_matches_the_shared_case(string adapter)
    {
        var args = CliModelProbe.ListingArgs(adapter);

        Assert.Equal(ProbeCases["listing_args"]![adapter]!.AsArray().Select(a => (string)a!), args);
    }

    [Fact]
    public void Model_listings_match_the_shared_cases()
    {
        foreach (var listing in ProbeCases["listings"]!.AsArray())
        {
            var models = CliModelProbe.ParseModelList((string)listing!["output"]!);

            Assert.Equal(listing["models"]?.ToJsonString(), models?.ToJsonString());
        }
    }

    private static JsonArray Models(params string[] ids) => new(ids.Select(id => (JsonNode?)new JsonObject { ["id"] = id }).ToArray());

    [Fact]
    public async Task A_probe_answer_is_shared_instead_of_spawning_the_cli_again()
    {
        var spawns = 0;
        Task<JsonArray?> Spawn() { spawns++; return Task.FromResult<JsonArray?>(Models("opus")); }

        var first = await CliModelProbe.Cached("shared-answer", Spawn);
        var second = await CliModelProbe.Cached("shared-answer", Spawn);

        Assert.Equal(1, spawns);
        Assert.NotSame(first, second);
        Assert.Equal("opus", (string)second![0]!["id"]!);
    }

    [Fact]
    public async Task An_unanswered_probe_is_retried_on_the_next_call()
    {
        var spawns = 0;
        Task<JsonArray?> Spawn() { spawns++; return Task.FromResult<JsonArray?>(null); }

        var first = await CliModelProbe.Cached("unanswered", Spawn);
        var second = await CliModelProbe.Cached("unanswered", Spawn);

        Assert.Null(first);
        Assert.Null(second);
        Assert.Equal(2, spawns);
    }

    [Fact]
    public async Task A_cached_list_can_be_attached_to_two_responses()
    {
        var spawn = () => Task.FromResult<JsonArray?>(Models("a", "b"));

        var one = new JsonObject { ["models"] = await CliModelProbe.Cached("two-parents", spawn) };
        var two = new JsonObject { ["models"] = await CliModelProbe.Cached("two-parents", spawn) };

        Assert.Equal(2, one["models"]!.AsArray().Count);
        Assert.Equal(2, two["models"]!.AsArray().Count);
    }

    [Theory]
    [InlineData(new[] { "default", "opus", "sonnet", "haiku" }, null, false, "sonnet")]
    [InlineData(new[] { "default", "opus", "sonnet", "haiku" }, null, true, "opus")]
    [InlineData(new[] { "opus", "sonnet", "haiku" }, null, false, "sonnet")]
    [InlineData(new[] { "default", "opus", "sonnet" }, "default", false, "default")]
    [InlineData(new[] { "default" }, null, false, "default")]
    [InlineData(new string[0], null, false, "")]
    public void A_blank_model_is_picked_without_the_cli_pseudo_model(string[] ids, string? current, bool first, string expected)
    {
        var picked = ModelCatalog.PickId(ids, current, first);

        Assert.Equal(expected, picked);
    }
}
