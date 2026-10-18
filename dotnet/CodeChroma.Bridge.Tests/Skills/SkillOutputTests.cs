using System.Text.Json.Nodes;
using CodeChroma.Bridge.Skills;

namespace CodeChroma.Bridge.Tests.Skills;

public class SkillOutputTests
{
    private const string Repo = "/repo";

    private static JsonNode Assistant(params string[] blocks) => JsonNode.Parse("""{"type":"assistant","message":{"content":[""" + string.Join(",", blocks) + "]}}")!;

    private static string ToolUse(string name, string input) => $$"""{"type":"tool_use","name":"{{name}}","input":{{input}}}""";

    private static string[] Render(JsonNode? node) => SkillOutput.Render(node, Repo).ToArray();

    [Fact]
    public void A_tool_call_renders_as_its_name_and_the_repo_relative_path()
    {
        var lines = Render(Assistant(ToolUse("Read", """{"file_path":"/repo/src/engine.py"}""")));

        Assert.Equal(["⏺ Read(src/engine.py)"], lines);
    }

    [Theory]
    [InlineData("""{"pattern":"def analyze"}""", "⏺ Grep(def analyze)")]
    [InlineData("""{"command":"python check_c1.py"}""", "⏺ Grep(python check_c1.py)")]
    [InlineData("""{"path":"src/codechroma"}""", "⏺ Grep(src/codechroma)")]
    [InlineData("""{"url":"http://localhost:8000/c1"}""", "⏺ Grep(http://localhost:8000/c1)")]
    [InlineData("""{"description":"map the pillars"}""", "⏺ Grep(map the pillars)")]
    [InlineData("""{"unknown_key":"ignored"}""", "⏺ Grep")]
    public void The_argument_shown_is_the_first_recognized_input_key(string input, string expected)
    {
        var lines = Render(Assistant(ToolUse("Grep", input)));

        Assert.Equal([expected], lines);
    }

    [Fact]
    public void A_path_outside_the_repo_is_left_absolute()
    {
        var lines = Render(Assistant(ToolUse("Write", """{"file_path":"/elsewhere/notes.md"}""")));

        Assert.Equal(["⏺ Write(/elsewhere/notes.md)"], lines);
    }

    [Fact]
    public void A_multiline_argument_collapses_to_one_bounded_line()
    {
        var lines = Render(Assistant(ToolUse("Bash", """{"command":"python check.py \\\n  --strict\n"}""")));

        Assert.Equal(["⏺ Bash(python check.py \\ --strict)"], lines);
    }

    [Fact]
    public void An_overlong_argument_is_truncated_with_an_ellipsis()
    {
        var lines = Render(Assistant(ToolUse("Bash", $$"""{"command":"{{new string('x', 500)}}"}""")));

        Assert.Equal([$"⏺ Bash({new string('x', 99)}…)"], lines);
    }

    [Fact]
    public void Assistant_prose_keeps_line_breaks_but_drops_blank_runs()
    {
        var lines = Render(Assistant("""{"type":"text","text":"Mapping the boundary.\n\n\nThen the pillars.\n"}"""));

        Assert.Equal(["Mapping the boundary.", "Then the pillars."], lines);
    }

    [Theory]
    [InlineData("let me consider the layering", "let me consider the layering")]
    [InlineData("   ", null)]
    public void A_thinking_block_renders_collapsed_or_not_at_all(string thinking, string? expected)
    {
        var lines = Render(Assistant($$"""{"type":"thinking","thinking":"{{thinking}}"}"""));

        Assert.Equal(expected is null ? [] : new[] { expected }, lines);
    }

    [Fact]
    public void An_overlong_thinking_block_is_truncated()
    {
        var lines = Render(Assistant($$"""{"type":"thinking","thinking":"{{new string('x', 500)}}"}"""));

        Assert.Equal([new string('x', 199) + "…"], lines);
    }

    [Fact]
    public void A_successful_tool_result_is_not_repeated_in_the_feed()
    {
        var lines = Render(JsonNode.Parse("""{"type":"user","message":{"content":[{"type":"tool_result","content":"1\thello"}]}}"""));

        Assert.Empty(lines);
    }

    [Theory]
    [InlineData("""{"type":"tool_result","is_error":true,"content":"Traceback...\nboom"}""", "  ↳ error: Traceback... boom")]
    [InlineData("""{"type":"tool_result","is_error":true,"content":[{"type":"text","text":"no such file"}]}""", "  ↳ error: no such file")]
    public void A_failed_tool_result_is_one_indented_line(string block, string expected)
    {
        var lines = Render(JsonNode.Parse("""{"type":"user","message":{"content":[""" + block + "]}}"));

        Assert.Equal([expected], lines);
    }

    [Theory]
    [InlineData("""{"type":"result","is_error":false,"duration_api_ms":5279}""", "✓ done in 5s")]
    [InlineData("""{"type":"result","is_error":false}""", "✓ done")]
    [InlineData("""{"type":"result","is_error":true,"subtype":"error_max_turns"}""", "✗ error_max_turns")]
    [InlineData("""{"type":"result","is_error":true,"subtype":"success","result":"API Error: SSL certificate verification failed"}""", "✗ API Error: SSL certificate verification failed")]
    public void The_final_result_reports_completion_or_failure(string json, string expected)
    {
        var lines = Render(JsonNode.Parse(json));

        Assert.Equal([expected], lines);
    }

    [Theory]
    [InlineData("""{"type":"system","subtype":"thinking_tokens"}""")]
    [InlineData("""{"type":"system","subtype":"init","tools":["Bash"]}""")]
    [InlineData("""{"type":"rate_limit_event"}""")]
    [InlineData("""{"type":"stream_event","event":{}}""")]
    [InlineData("""{}""")]
    [InlineData("""{"type":"assistant"}""")]
    [InlineData("""{"type":"assistant","message":"not-a-dict"}""")]
    [InlineData("""{"type":"assistant","message":{"content":["not-a-block"]}}""")]
    [InlineData("""{"type":"user","message":{"content":null}}""")]
    [InlineData("\"a string\"")]
    public void Noise_and_malformed_events_render_nothing(string json)
    {
        var lines = Render(JsonNode.Parse(json));

        Assert.Empty(lines);
    }

    [Fact]
    public void A_null_event_renders_nothing() => Assert.Empty(Render(null));

    [Fact]
    public void String_message_content_is_treated_as_text()
    {
        var lines = Render(JsonNode.Parse("""{"type":"assistant","message":{"content":"Done mapping."}}"""));

        Assert.Equal(["Done mapping."], lines);
    }
}
