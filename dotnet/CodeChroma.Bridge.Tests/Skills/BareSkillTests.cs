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

    [Fact]
    public void An_interactive_start_inlines_the_type_body_and_asks_the_user_what_to_draw()
    {
        var prompt = BareSkill.ComposeInteractive("c1", Root, "main", "ctx-tool --repo-path x")!;

        Assert.Contains("Draw the C1", prompt);
        Assert.Contains("ask what they want to see", prompt);
        Assert.Contains("ctx-tool --repo-path x \"phrase\"", prompt);
        Assert.DoesNotContain("{BRIDGE}", prompt);
    }

    [Fact]
    public void An_open_interactive_start_loads_no_skill_until_the_user_answers()
    {
        var prompt = BareSkill.ComposeInteractive("any", Root, "main", null)!;

        Assert.Contains("ask what they want to see", prompt);
        Assert.Contains("is not loaded yet", prompt);
        Assert.DoesNotContain("Router", prompt);
    }

    [Fact]
    public void An_interactive_start_the_terminal_already_asked_about_does_not_ask_again()
    {
        var prompt = BareSkill.ComposeInteractive("any", Root, "main", "ctx-tool --repo-path x", askedInTerminal: true)!;

        Assert.Contains("Do not greet or ask again", prompt);
        Assert.DoesNotContain("ask what they want to see", prompt);
        Assert.Contains("Start by running `ctx-tool --repo-path x \"phrase\"", prompt);
    }

    [Fact]
    public void A_requested_start_states_the_type_scope_and_request_and_never_asks()
    {
        var prompt = BareSkill.ComposeInteractive("sequence", Root, "main", "ctx-tool --repo-path x", request: "how a save reaches the db")!;

        Assert.Contains("picked the `sequence` diagram type", prompt);
        Assert.Contains("how a save reaches the db", prompt);
        Assert.Contains("do not greet them or ask what to draw", prompt);
        Assert.DoesNotContain("ask what they want to see", prompt);
        Assert.Contains("ctx-tool --repo-path x \"phrase\"", prompt);
    }

    [Fact]
    public void A_plan_request_draws_the_impact_body_and_names_the_feature_plan_reference()
    {
        var prompt = BareSkill.ComposeInteractive("plan", Root, "main", null, request: "token auth")!;

        Assert.Contains("Draw the Impact diagram", prompt);
        Assert.Contains("feature-plan-mode.md", prompt);
    }

    [Fact]
    public void An_interactive_start_without_a_context_command_does_not_mention_one()
    {
        var prompt = BareSkill.ComposeInteractive("c1", Root, "main", null)!;

        Assert.DoesNotContain("\"phrase\"", prompt);
    }
}
