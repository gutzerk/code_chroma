using System.Text.Json;
using System.Text.Json.Serialization;

namespace CodeChroma.Bridge.Workflows;

public sealed class WorkflowStep
{
    public string Id { get; set; } = "";
    public string Slug { get; set; } = "";
    public string Kind { get; set; } = "agent";
    public string Prompt { get; set; } = "";
}

public sealed class WorkflowDef
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public List<WorkflowStep> Steps { get; set; } = [];
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
