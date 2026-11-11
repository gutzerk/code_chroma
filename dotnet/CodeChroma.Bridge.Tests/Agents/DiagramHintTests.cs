using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;

namespace CodeChroma.Bridge.Tests.Agents;

/// <summary>DiagramHint.Parse: a Draw request may be absent, but a present one must have text.</summary>
public sealed class DiagramHintTests
{
    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(" \n\t ")]
    public void A_blank_diagram_request_is_refused(string request)
    {
        var body = new JsonObject { ["diagram_request"] = request };

        var hint = DiagramHint.Parse(body);

        Assert.Equal("diagram_request must be a non-empty string", hint.Error);
    }

    [Fact]
    public void An_absent_diagram_request_is_still_valid()
    {
        var body = new JsonObject();

        var hint = DiagramHint.Parse(body);

        Assert.Null(hint.Error);
        Assert.Null(hint.Request);
    }

    [Fact]
    public void A_diagram_request_with_text_is_trimmed_and_kept()
    {
        var body = new JsonObject { ["diagram_request"] = "  how a save reaches the db  " };

        var hint = DiagramHint.Parse(body);

        Assert.Null(hint.Error);
        Assert.Equal("how a save reaches the db", hint.Request);
    }
}
