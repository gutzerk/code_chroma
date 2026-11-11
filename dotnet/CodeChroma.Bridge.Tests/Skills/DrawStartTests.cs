using CodeChroma.Bridge.Skills;

namespace CodeChroma.Bridge.Tests.Skills;

/// <summary>DrawStart.Plan: what POST /agents/{id}/start launches for a drawing window on each path.</summary>
public class DrawStartTests
{
    private const string Root = "/repo";

    [Fact]
    public void A_requested_claude_window_starts_normal_with_the_request_and_the_drawer()
    {
        var start = DrawStart.Plan("sequence", "how a save reaches the db", "task", resumed: false, delegates: true, splitsSystemPrompt: true, Root, "main", null);

        Assert.Equal("how a save reaches the db", start.TaskText);
        Assert.False(start.Bare);
        Assert.Null(start.Banner);
        Assert.NotNull(start.Delegation);
    }

    [Fact]
    public void An_open_claude_window_asks_in_the_terminal_and_sends_no_prompt()
    {
        var start = DrawStart.Plan("any", null, "task", resumed: false, delegates: true, splitsSystemPrompt: true, Root, "main", null);

        Assert.Null(start.TaskText);
        Assert.Equal(BareSkill.InteractiveQuestion, start.Banner);
        Assert.Contains("Do not greet or ask again", start.Delegation!.Start);
    }

    [Fact]
    public void A_typed_claude_window_without_a_request_opens_with_the_visible_prompt()
    {
        var start = DrawStart.Plan("sequence", null, "task", resumed: false, delegates: true, splitsSystemPrompt: true, Root, "main", null);

        Assert.Equal(BareSkill.InteractiveVisiblePrompt, start.TaskText);
        Assert.Null(start.Banner);
    }

    [Fact]
    public void A_resumed_or_forked_claude_window_keeps_its_prompt_and_gets_the_drawer_again()
    {
        var start = DrawStart.Plan("any", null, null, resumed: true, delegates: true, splitsSystemPrompt: true, Root, "main", null);

        Assert.Null(start.TaskText);
        Assert.Null(start.Banner);
        Assert.False(start.Bare);
        Assert.NotNull(start.Delegation);
    }

    [Fact]
    public void Another_cli_starts_bare_with_the_skill_inlined()
    {
        var start = DrawStart.Plan("sequence", "how a save reaches the db", "task", resumed: false, delegates: false, splitsSystemPrompt: true, Root, "main", null);

        Assert.Null(start.Delegation);
        Assert.True(start.Bare);
        Assert.Contains("Draw a Sequence diagram", start.TaskText);
        Assert.Equal("how a save reaches the db", start.Visible);
    }

    [Fact]
    public void Another_cli_resumed_without_a_prompt_launches_unchanged()
    {
        var start = DrawStart.Plan("sequence", null, null, resumed: true, delegates: false, splitsSystemPrompt: true, Root, "main", null);

        Assert.Equal(new DrawStart(null, null, false, null, null), start);
    }
}
