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

    [Fact]
    public void A_long_result_keeps_its_tail()
    {
        var output = new string('x', 5000) + "END";

        var result = StepResults.Extract(output);

        Assert.StartsWith("...", result);
        Assert.EndsWith("END", result);
    }
}
