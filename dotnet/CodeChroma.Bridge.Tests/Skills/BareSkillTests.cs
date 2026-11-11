using CodeChroma.Bridge.Skills;

namespace CodeChroma.Bridge.Tests.Skills;

public class BareSkillTests
{
    private const string Root = "/repo";

    [Theory]
    [InlineData("system-context", "Draw the System context")]
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
        var short1 = BareSkill.Compose("/codechroma-draw-diagram type: system-context — read references/type-system-context.md before writing anything — x", Root, "main")!;

        Assert.True(short1.Length < full.Length / 3, $"short {short1.Length} vs full {full.Length}");
    }

    [Fact]
    public void An_interactive_start_inlines_the_type_body_and_asks_the_user_what_to_draw()
    {
        var prompt = BareSkill.ComposeInteractive("system-context", Root, "main", "ctx-tool --repo-path x")!;

        Assert.Contains("Draw the System context", prompt);
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
    public void A_requested_start_states_the_type_and_request_and_never_asks()
    {
        var prompt = BareSkill.ComposeInteractive("sequence", Root, "main", "ctx-tool --repo-path x", request: "how a save reaches the db")!;

        Assert.Contains("picked the `sequence` diagram type", prompt);
        Assert.Contains("how a save reaches the db", prompt);
        Assert.Contains("do not greet them or ask what to draw", prompt);
        Assert.DoesNotContain("ask what they want to see", prompt);
        Assert.Contains("ctx-tool --repo-path x \"phrase\"", prompt);
    }

    [Fact]
    public void A_requested_start_asks_the_agent_to_title_the_diagram_from_the_request()
    {
        var prompt = BareSkill.ComposeInteractive("sequence", Root, "main", null, request: "how a save reaches the db")!;

        Assert.Contains("Name the diagram from this request", prompt);
        Assert.Contains("/repos/main/diagrams/status", prompt);
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
        var prompt = BareSkill.ComposeInteractive("system-context", Root, "main", null)!;

        Assert.DoesNotContain("\"phrase\"", prompt);
    }

    [Fact]
    public void A_drawing_window_gives_the_skill_to_the_drawer_and_keeps_the_lead_short()
    {
        var delegation = BareSkill.ComposeDelegation("system-context", Root, "main", "ctx-tool --repo-path x")!;

        Assert.Contains("Draw the System context", delegation.DrawerPrompt);
        Assert.Contains("ctx-tool --repo-path x \"phrase\"", delegation.DrawerPrompt);
        Assert.Contains("cannot ask the user", delegation.DrawerPrompt);
        Assert.Contains(BareSkill.DrawerName, delegation.Lead);
        Assert.DoesNotContain("Draw the System context", delegation.Lead);
        Assert.Contains("ask what they want to see", delegation.Start);
    }

    [Fact]
    public void A_requested_drawing_window_hands_the_request_over_without_asking()
    {
        var delegation = BareSkill.ComposeDelegation("sequence", Root, "main", null, request: "how a save reaches the db")!;

        Assert.Contains("how a save reaches the db", delegation.Start);
        Assert.Contains("do not greet them or ask what to draw", delegation.Start);
        Assert.DoesNotContain("ask what they want to see", delegation.Start);
        Assert.Contains("Name the diagram from this request", delegation.DrawerPrompt);
    }

    [Fact]
    public void A_drawing_window_the_terminal_already_asked_about_does_not_ask_again()
    {
        var delegation = BareSkill.ComposeDelegation("any", Root, "main", null, askedInTerminal: true)!;

        Assert.Contains("Do not greet or ask again", delegation.Start);
        Assert.Contains("is not loaded yet", delegation.DrawerPrompt);
    }

    [Fact]
    public void The_standing_lead_carries_no_start_block()
    {
        var delegation = BareSkill.ComposeDelegation("sequence", Root, "main", null, request: "how a save reaches the db")!;

        Assert.DoesNotContain("How this session starts", delegation.Lead);
        Assert.DoesNotContain("how a save reaches the db", delegation.Lead);
        Assert.Contains(BareSkill.DrawerName, delegation.Lead);
    }

    [Fact]
    public void A_plan_drawing_window_gives_the_drawer_the_impact_body_and_the_feature_plan_reference()
    {
        var delegation = BareSkill.ComposeDelegation("plan", Root, "main", null, request: "token auth")!;

        Assert.Contains("Draw the Impact diagram", delegation.DrawerPrompt);
        Assert.Contains("feature-plan-mode.md", delegation.DrawerPrompt);
        Assert.Contains("`feature plan` diagram type", delegation.Lead);
    }

    [Fact]
    public void The_drawer_plugin_offers_one_agent_under_its_plugin_name()
    {
        var root = SubagentPlugin.Write(BareSkill.DrawerPlugin, BareSkill.DrawerAgent, "Draws: \"quoted\".", "PROMPT", "Bash,Read");

        var agent = File.ReadAllText(Path.Combine(root, "agents", "drawer.md"));
        Assert.Contains("\"name\":\"codechroma-draw\"", File.ReadAllText(Path.Combine(root, ".claude-plugin", "plugin.json")));
        Assert.StartsWith("---\nname: drawer\ndescription: \"Draws: \\u0022quoted\\u0022.\"\ntools: Bash, Read\n---", agent);
        Assert.EndsWith("PROMPT", agent);
        Assert.Equal("codechroma-draw:drawer", BareSkill.DrawerName);
    }

    [Fact]
    public void A_drawing_window_pre_approves_only_diagram_writes_and_the_drawers_own_commands()
    {
        var rules = BareSkill.ComposeDelegation("sequence", Root, "main", "ctx-tool --repo-path x")!.AllowedTools.Split(',');

        Assert.Contains("Write(//repo/.codechroma/diagrams/**)", rules);
        Assert.Contains("Edit(//repo/.codechroma/diagrams/**)", rules);
        Assert.Contains("Bash(ctx-tool --repo-path x:*)", rules);
        Assert.Contains(rules, rule => rule.StartsWith("Bash(curl -s ") && rule.EndsWith("/:*)"));
        Assert.Contains(rules, rule => rule.Contains("check_diagram.py") && rule.EndsWith(":*)"));
        Assert.DoesNotContain("Bash", rules);
        Assert.DoesNotContain("Write", rules);
        Assert.DoesNotContain("Edit", rules);
    }

    [Fact]
    public void Writing_the_same_drawer_again_leaves_the_file_a_running_cli_reads_in_place()
    {
        var root = SubagentPlugin.Write(BareSkill.DrawerPlugin, BareSkill.DrawerAgent, "d", "SAME PROMPT", "Read");
        var file = Path.Combine(root, "agents", "drawer.md");
        var written = File.GetLastWriteTimeUtc(file);
        File.SetLastWriteTimeUtc(file, written.AddHours(-1));

        SubagentPlugin.Write(BareSkill.DrawerPlugin, BareSkill.DrawerAgent, "d", "SAME PROMPT", "Read");

        Assert.Equal(written.AddHours(-1), File.GetLastWriteTimeUtc(file));
        Assert.Empty(Directory.GetFiles(Path.Combine(root, "agents"), "*.tmp"));
    }

    [Fact]
    public void A_workflow_start_inlines_the_workflow_skill_and_the_users_description()
    {
        var prompt = BareSkill.ComposeWorkflow(Root, "plan, implement, then let me review")!;

        Assert.Contains("/repos/main/workflows", prompt);
        Assert.Contains("plan, implement, then let me review", prompt);
        Assert.Contains("do not greet them", prompt);
        Assert.DoesNotContain("{BRIDGE}", prompt);
        Assert.DoesNotContain("name: codechroma-workflow", prompt);
    }
}
