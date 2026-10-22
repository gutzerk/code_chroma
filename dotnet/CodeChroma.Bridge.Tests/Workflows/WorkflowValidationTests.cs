using CodeChroma.Bridge.Workflows;

namespace CodeChroma.Bridge.Tests.Workflows;

/// <summary>Save-time checks: agent modes, providers, and continue never falling back.</summary>
public sealed class WorkflowValidationTests
{
    private static readonly Dictionary<string, string> Adapters = new() { ["claude-a"] = "claude", ["claude-b"] = "claude", ["codex"] = "codex" };

    private static string? AdapterOf(string? provider) => provider is null ? "claude" : Adapters.GetValueOrDefault(provider);

    private static string? CodexByDefault(string? provider) => provider is null ? "codex" : Adapters.GetValueOrDefault(provider);

    private static WorkflowStep Agent(string id, string agent = StepAgents.New, string? provider = null) =>
        new() { Id = id, Slug = id, Kind = "agent", Prompt = "do " + id, Agent = agent, Provider = provider };

    private static WorkflowStep Review(string id) => new() { Id = id, Slug = id, Kind = "review" };

    private static WorkflowDef Def(params WorkflowStep[] steps) => new() { Id = "wf", Name = "Flow", Steps = steps.ToList() };

    [Theory]
    [InlineData("step")]
    [InlineData("workflow")]
    [InlineData("conflict")]
    public void Accepting_mirrored_inputs_still_refuses_duplicate_or_conflicting_inputs(string scenario)
    {
        var def = Def(Agent("one"), Agent("two"));
        def.Steps[0].Input = new WorkflowInput { Name = "ticket", Label = "Ticket" };
        if (scenario == "step") def.Steps[1].Input = new WorkflowInput { Name = "ticket", Label = "Ticket" };
        else if (scenario == "workflow") def.Inputs = [new WorkflowInput { Name = "ticket", Label = "Ticket" }, new WorkflowInput { Name = "ticket", Label = "Ticket" }];
        else def.Inputs = [new WorkflowInput { Name = "ticket", Label = "Different question" }];

        var error = WorkflowValidation.Validate(def, AdapterOf);

        Assert.Equal("Workflow inputs need unique simple names", error);
    }

    [Fact]
    public void A_continue_chain_on_the_default_claude_provider_is_valid()
    {
        var def = Def(Agent("plan"), Agent("build", StepAgents.Handoff), Agent("ship", "continue:build"), Agent("tidy", StepAgents.Continue));

        var error = WorkflowValidation.Validate(def, AdapterOf);

        Assert.Null(error);
    }

    [Fact]
    public void A_step_without_an_agent_mode_reads_its_older_context_field()
    {
        var def = Def(new WorkflowStep { Id = "a", Slug = "a", Kind = "agent", Prompt = "go", Context = "fresh" }, new WorkflowStep { Id = "b", Slug = "b", Kind = "agent", Prompt = "go" });

        var error = WorkflowValidation.Validate(def, AdapterOf);

        Assert.Null(error);
        Assert.Equal([StepAgents.New, StepAgents.Handoff], def.Steps.Select(s => s.Agent));
        Assert.All(def.Steps, s => Assert.Null(s.Context));
    }

    [Theory]
    [InlineData("first-continue")]
    [InlineData("continue-later-step")]
    [InlineData("continue-review")]
    [InlineData("continue-unknown")]
    [InlineData("bad-mode")]
    [InlineData("review-with-agent")]
    [InlineData("unknown-provider")]
    [InlineData("across-providers")]
    [InlineData("non-claude-provider")]
    public void A_continue_that_could_not_resume_is_refused(string scenario)
    {
        var def = scenario switch
        {
            "first-continue" => Def(Agent("plan", StepAgents.Continue)),
            "continue-later-step" => Def(Agent("plan", "continue:build"), Agent("build")),
            "continue-review" => Def(Agent("plan"), Review("check"), Agent("fix", "continue:check")),
            "continue-unknown" => Def(Agent("plan"), Agent("fix", "continue:nope")),
            "bad-mode" => Def(Agent("plan", "sometimes")),
            "review-with-agent" => Def(Agent("plan"), new WorkflowStep { Id = "check", Slug = "check", Kind = "review", Agent = StepAgents.Continue }),
            "unknown-provider" => Def(Agent("plan", provider: "ghost")),
            "across-providers" => Def(Agent("plan", provider: "claude-a"), Agent("build", StepAgents.Continue, "claude-b")),
            _ => Def(Agent("plan", provider: "codex"), Agent("build", StepAgents.Continue, "codex")),
        };

        var error = WorkflowValidation.Validate(def, AdapterOf);

        Assert.NotNull(error);
    }

    [Fact]
    public void A_continue_is_refused_when_the_call_site_default_is_not_claude()
    {
        var def = Def(Agent("plan"), Agent("build", StepAgents.Continue));

        var error = WorkflowValidation.Validate(def, CodexByDefault);

        Assert.Equal("build: only claude can continue a session", error);
    }

    [Fact]
    public void Chain_length_follows_continue_links_back_to_a_step_that_does_not_continue()
    {
        var def = Def(Agent("plan"), Agent("build", StepAgents.Handoff), Agent("ship", StepAgents.Continue), Agent("tidy", "continue:ship"));

        var lengths = Enumerable.Range(0, def.Steps.Count).Select(i => StepAgents.ChainLength(def, i)).ToList();

        Assert.Equal([1, 1, 2, 3], lengths);
    }
}
