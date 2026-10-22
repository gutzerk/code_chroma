using CodeChroma.Bridge.Skills;

namespace CodeChroma.Bridge.Workflows;

/// <summary>The checks a workflow definition must pass before it is saved; continue never falls back, so a continue that cannot resume is refused here.</summary>
public static class WorkflowValidation
{
    /// <summary>The first problem with <paramref name="def"/>, or null; <paramref name="adapterOf"/> maps a provider id (null: the call-site default) to its CLI adapter, null when unknown.</summary>
    public static string? Validate(WorkflowDef? def, Func<string?, string?> adapterOf)
    {
        if (def is null || string.IsNullOrWhiteSpace(def.Id) || !RunStore.IsSafeId(def.Id) || string.IsNullOrWhiteSpace(def.Name) || def.Steps is null || def.Steps.Count == 0 ||
            def.Steps.Any(s => s is null || string.IsNullOrWhiteSpace(s.Id) || !RunStore.IsSafeId(s.Id) || string.IsNullOrWhiteSpace(s.Slug) ||
                (s.Kind != "agent" && s.Kind != "review") || (s.Kind == "agent" && string.IsNullOrWhiteSpace(s.Prompt))) ||
            def.Steps.Select(s => s.Id).Distinct().Count() != def.Steps.Count)
            return "A workflow needs an id, name and uniquely identified agent steps with prompts or review steps";
        StepAgents.Normalize(def);
        if (def.Steps.Any(s => !StepAgents.IsValid(s.Agent))) return "A step agent must be new, handoff, continue or continue:<stepId>";
        for (var i = 0; i < def.Steps.Count; i++)
        {
            var back = def.Steps[i].SendBackTo;
            if (back is null) continue;
            if (!def.Steps.Take(i).Any(s => s.Id == back && s.Kind == "agent")) return "sendBackTo must name an earlier agent step";
        }
        if (def.Steps.Any(s => s.Kind == "review" && s.Input is not null)) return "Only agent steps can ask for an input";
        if (AgentProblem(def, adapterOf) is { } agentProblem) return agentProblem;
        def.Inputs = (def.Inputs ?? []).Where(i => i is not null).ToList();
        var stepInputs = def.Steps.Where(s => s.Input is not null).Select(s => s.Input!).ToList();
        var all = stepInputs.Concat(def.Inputs).ToList();
        if (all.Any(i => !RunStore.IsSafeId(i.Name)) || all.Select(i => i.Name).Distinct().Count() != all.Count)
            return "Workflow inputs need unique simple names";
        def.Inputs = stepInputs;
        if (def.Steps.Any(s => s.Skill is { } skill && (skill.Length == 0 || !RunStore.IsSafeId(skill))))
            return "A step skill must be a skill name";
        return null;
    }

    /// <summary>Provider, model and continue rules: a known provider, and a continue whose source is an earlier agent step on the same claude provider.</summary>
    private static string? AgentProblem(WorkflowDef def, Func<string?, string?> adapterOf)
    {
        for (var i = 0; i < def.Steps.Count; i++)
        {
            var step = def.Steps[i];
            if (step.Kind == "review")
            {
                if (StepAgents.IsContinue(step.Agent) || step.Provider is not null || step.Model is not null || step.ExtraPrompt is not null)
                    return $"{step.Slug} is a You step: it has no agent, provider, model or step input";
                continue;
            }
            if (step.Provider is not null && adapterOf(step.Provider) is null) return $"{step.Slug} uses an unknown provider: {step.Provider}";
            if (!StepAgents.IsContinue(step.Agent)) continue;
            var source = StepAgents.SourceIndex(def, i);
            if (source < 0) return $"{step.Slug} continues a session, but there is no earlier agent step to continue";
            var from = def.Steps[source];
            if (!CliAdapters.CanResume(adapterOf(step.Provider))) return $"{step.Slug}: only claude can continue a session";
            if (step.Provider != from.Provider) return $"{step.Slug} continues {from.Slug}, so it must use the same provider";
        }
        return null;
    }
}
