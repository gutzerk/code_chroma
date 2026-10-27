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
}
