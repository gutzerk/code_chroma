using CodeChroma.Bridge.Workflows;
using Xunit;

namespace CodeChroma.Bridge.Tests.Workflows;

public class StepResultsTests
{
    [Fact]
    public void The_closing_prose_wins_over_tool_lines_and_the_done_marker()
    {
        var output = "⏺ Read(a.cs)\nfirst thought\n⏺ Edit(a.cs)\nFixed the bug.\nTests pass.\n✓ done in 4s";

        var result = StepResults.Extract(output);

        Assert.Equal("Fixed the bug.\nTests pass.", result);
    }

    [Fact]
    public void Output_with_only_tool_and_status_lines_has_no_result()
    {
        var output = "⏺ Read(a.cs)\n  ↳ error: boom\n✗ failed";

        var result = StepResults.Extract(output);

        Assert.Null(result);
    }

    [Theory]
    [InlineData("## Handoff\nUse src/client.ts.\n---\nTests pass.")]
    [InlineData("Implemented:\n✓ Added the API\n✓ Updated the client\n✓ All tests pass")]
    [InlineData("First paragraph.\n\nSecond paragraph.")]
    [InlineData("✓ done with the migration")]
    [InlineData("✓ done in stages")]
    public void Markdown_in_the_final_answer_is_preserved(string answer)
    {
        var output = "⏺ Edit(a.cs)\n" + answer + "\n✓ done in 4s";

        var result = StepResults.Extract(output);

        Assert.Equal(answer, result);
    }

    [Fact]
    public void An_answer_without_a_completion_marker_is_preserved()
    {
        var output = "⏺ Edit(a.cs)\nSummary\n---\n✓ Updated the client";

        var result = StepResults.Extract(output);

        Assert.Equal("Summary\n---\n✓ Updated the client", result);
    }

    [Fact]
    public void A_long_result_keeps_its_tail()
    {
        var output = new string('x', 5000) + "END";

        var result = StepResults.Extract(output);

        Assert.StartsWith("...", result);
        Assert.EndsWith("END", result);
    }
}
