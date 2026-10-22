using System.Text.Json;
using System.Text.Json.Serialization;

namespace CodeChroma.Bridge.Workflows;

public sealed class WorkflowStep
{
    public string Id { get; set; } = "";
    public string Slug { get; set; } = "";
    public string Kind { get; set; } = "agent";
    public string Prompt { get; set; } = "";
    public string? Skill { get; set; }
    /// <summary>new, handoff, continue or continue:&lt;stepId&gt;; null only before <see cref="StepAgents.Normalize"/>.</summary>
    public string? Agent { get; set; }

    /// <summary>Read from older files only (previous or fresh) and mapped to <see cref="Agent"/>; never written.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Context { get; set; }

    /// <summary>Free text appended after the instructions, for this step only.</summary>
    public string? ExtraPrompt { get; set; }

    /// <summary>An LLM settings provider id; null runs the workflow-step call-site assignment.</summary>
    public string? Provider { get; set; }

    public string? Model { get; set; }
    public bool PauseBefore { get; set; }
    public bool ShowDiff { get; set; }
    public bool ShowSummary { get; set; }
    public string? SendBackTo { get; set; }
    public WorkflowInput? Input { get; set; }
}

public sealed class WorkflowInput
{
    public string Name { get; set; } = "";
    public string Label { get; set; } = "";
}

public sealed class WorkflowDef
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public List<WorkflowStep> Steps { get; set; } = [];
    public List<WorkflowInput> Inputs { get; set; } = [];

    /// <summary>Every value a run must be given: each step's own input, then any older workflow-level ones.</summary>
    public List<WorkflowInput> AllInputs() =>
        Steps.Where(s => s.Input is not null).Select(s => s.Input!).Concat(Inputs).GroupBy(i => i.Name).Select(g => g.First()).ToList();
}

public sealed class RunAttempt
{
    public int N { get; set; }
    public string? Branch { get; set; }
    public List<StepRecord>? Steps { get; set; }
}

public sealed class StepRecord
{
    public string StepId { get; set; } = "";
    public int Attempt { get; set; } = 1;
    public string Status { get; set; } = "pending";
    public string Output { get; set; } = "";
    public string? DiffStat { get; set; }
    public string? CheckpointRef { get; set; }
    public string? SessionId { get; set; }
    public int? FromAttempt { get; set; }
    public StepUsage? Usage { get; set; }

    /// <summary>The step whose session this step resumed (forked), when it did.</summary>
    public string? ResumedFrom { get; set; }
}

/// <summary>Token counts of a step's session as its CLI transcript reports them; context = input + cache read + cache creation.</summary>
public sealed class StepUsage
{
    public long ContextTokens { get; set; }
    public long InputTokens { get; set; }
    public long OutputTokens { get; set; }
    public long CacheReadTokens { get; set; }
}

/// <summary>The per-step agent modes and how a continue step finds its source.</summary>
public static class StepAgents
{
    public const string New = "new";
    public const string Handoff = "handoff";
    public const string Continue = "continue";
    private const string ContinuePrefix = "continue:";

    public static bool IsContinue(string? agent) => agent == Continue || (agent?.StartsWith(ContinuePrefix, StringComparison.Ordinal) ?? false);

    public static bool IsValid(string? agent) => agent is New or Handoff or Continue || (agent is not null && agent.StartsWith(ContinuePrefix, StringComparison.Ordinal) && agent.Length > ContinuePrefix.Length);

    /// <summary>Maps an older context field to an agent mode (previous or missing is handoff, fresh is new) and blanks empty provider/model.</summary>
    public static void Normalize(WorkflowDef def)
    {
        foreach (var step in def.Steps)
        {
            if (step is null) continue;
            step.Agent ??= step.Context == "fresh" ? New : Handoff;
            step.Context = null;
            if (string.IsNullOrWhiteSpace(step.Provider)) step.Provider = null;
            if (string.IsNullOrWhiteSpace(step.Model)) step.Model = null;
            if (string.IsNullOrWhiteSpace(step.ExtraPrompt)) step.ExtraPrompt = null;
        }
    }

    /// <summary>The index of the agent step a continue step at <paramref name="index"/> resumes, or -1 when it has none.</summary>
    public static int SourceIndex(WorkflowDef def, int index)
    {
        var agent = def.Steps[index].Agent;
        if (agent == Continue) return Enumerable.Range(0, index).Reverse().FirstOrDefault(i => def.Steps[i].Kind == "agent", -1);
        if (agent is null || !agent.StartsWith(ContinuePrefix, StringComparison.Ordinal)) return -1;
        var id = agent[ContinuePrefix.Length..];
        return def.Steps.FindIndex(0, index, s => s.Id == id && s.Kind == "agent");
    }

    /// <summary>How many steps a continue chain ending at <paramref name="index"/> spans (1 for a step that does not continue).</summary>
    public static int ChainLength(WorkflowDef def, int index)
    {
        var length = 1;
        for (var i = SourceIndex(def, index); i >= 0; i = SourceIndex(def, i)) length++;
        return length;
    }
}

public sealed class RunChip
{
    public string Label { get; set; } = "";
    public string NodeId { get; set; } = "";
}

public sealed class RunMessage
{
    public string Id { get; set; } = "";
    public string Target { get; set; } = "run";
    public string Role { get; set; } = "user";
    public string Text { get; set; } = "";
    public string At { get; set; } = "";
    public List<RunChip>? Chips { get; set; }
}

public sealed class RedoCard
{
    public List<string> Reruns { get; set; } = [];
    public List<string> Keeps { get; set; } = [];
    public List<string> SetsAside { get; set; } = [];
    public string Note { get; set; } = "";
}

public sealed class RedoProposal
{
    public string From { get; set; } = "";
    public RedoCard Card { get; set; } = new();
}

public sealed class StepEdit
{
    public string Prompt { get; set; } = "";
    public bool SaveToWorkflow { get; set; }
}

public sealed class MessageReply
{
    public string Reply { get; set; } = "";
    public string MessageId { get; set; } = "";
}

public sealed class Run
{
    public string Id { get; set; } = "";
    public string WorkflowId { get; set; } = "";
    public string State { get; set; } = RunStates.Running;
    public string? CurrentStepId { get; set; }
    public string? StopAfter { get; set; }
    public int Attempt { get; set; } = 1;
    public List<RunAttempt> Attempts { get; set; } = [];
    public List<string> Breakpoints { get; set; } = [];
    public List<StepRecord> Steps { get; set; } = [];
    public List<RunMessage> Messages { get; set; } = [];
    public RedoProposal? RedoProposal { get; set; }
    public Dictionary<string, string> PromptOverrides { get; set; } = [];
    public Dictionary<string, string> Inputs { get; set; } = [];
}

/// <summary>The camelCase wire and disk shape of definitions and run records.</summary>
public static class WorkflowJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };
}
