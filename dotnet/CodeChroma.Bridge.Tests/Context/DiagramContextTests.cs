using CodeChroma.Bridge.Context;

namespace CodeChroma.Bridge.Tests.Context;

public class DiagramContextTests
{
    [Fact]
    public void Impact_and_epics_get_no_gathered_context()
    {
        Assert.Equal(["c1", "custom", "patterns", "sequence"], DiagramContext.Types.Order());
    }

    [Theory]
    [InlineData("c1")]
    [InlineData("patterns")]
    public void Whole_repo_types_use_fixed_seed_phrases_not_the_request(string type)
    {
        var phrases = DiagramContext.Phrases(type, "something the user typed");

        Assert.True(phrases.Count > 1);
        Assert.DoesNotContain("something the user typed", phrases);
    }

    [Theory]
    [InlineData("sequence")]
    [InlineData("custom")]
    public void Request_driven_types_use_the_request_and_fall_back_when_it_is_blank(string type)
    {
        Assert.Equal(["how a login is saved"], DiagramContext.Phrases(type, "  how a login is saved "));
        Assert.Single(DiagramContext.Phrases(type, " "));
    }
}
