using CodeChroma.Bridge.Skills;

namespace CodeChroma.Bridge.Tests.Skills;

public class BareSkillTests
{
    private const string Root = "/repo";

    [Theory]
    [InlineData("c1", "Draw the C1")]
    [InlineData("patterns", "Draw the Design Patterns diagram")]
    [InlineData("impact", "Draw the Impact diagram")]
    [InlineData("sequence", "Draw a Sequence diagram")]
    public void Diagram_kinds_with_a_short_body_inline_only_that_body(string type, string title)
    {
        var prompt = BareSkill.Compose($"/codechroma-draw-diagram type: {type} — read references/type-{type}.md and references/drawing-rules.md before writing anything — do the thing", Root, "main")!;

        Assert.Contains(title, prompt);
        Assert.DoesNotContain("## references/", prompt);
        Assert.DoesNotContain("{BRIDGE}", prompt);
        Assert.DoesNotContain("{CHECK_COMMAND}", prompt);
        Assert.Contains($"--kind {type}", prompt);
        Assert.EndsWith("Task: do the thing", prompt);
    }

    [Fact]
    public void A_kind_without_a_short_body_inlines_the_skill_and_the_named_references()
    {
        var prompt = BareSkill.Compose("/codechroma-draw-diagram type: custom — read references/type-custom.md before writing anything — draw it", Root, "main")!;

        Assert.Contains("## references/type-custom.md", prompt);
        Assert.EndsWith("Task: type: custom — read references/type-custom.md before writing anything — draw it", prompt);
    }

    [Fact]
    public void A_prompt_that_is_not_a_slash_command_is_left_alone() => Assert.Equal("just do it", BareSkill.Compose("just do it", Root, "main"));

    [Fact]
    public void The_short_bodies_are_much_smaller_than_the_full_skill_prompt()
    {
        var full = BareSkill.Compose("/codechroma-draw-diagram type: custom — read references/type-custom.md and references/drawing-rules.md before writing anything — x", Root, "main")!;
        var short1 = BareSkill.Compose("/codechroma-draw-diagram type: c1 — read references/type-c1.md before writing anything — x", Root, "main")!;

        Assert.True(short1.Length < full.Length / 3, $"short {short1.Length} vs full {full.Length}");
    }
}
