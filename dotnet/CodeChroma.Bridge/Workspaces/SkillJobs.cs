using System.Collections.Concurrent;
using CodeChroma.Bridge.Http;

namespace CodeChroma.Bridge.Workspaces;

/// <summary>Per-workspace state of the headless skill runs ("c1", "impact-changes"); the runner itself is not ported.</summary>
public sealed class SkillJobs
{
    public static readonly IReadOnlyList<string> Kinds = ["c1", "impact-changes"];

    private readonly ConcurrentDictionary<string, JobState> _jobs = new();
    private readonly ConcurrentDictionary<string, List<string>> _output = new();
    private static readonly JobState Idle = new("idle", null);

    public JobState Get(string kind) => _jobs.GetValueOrDefault(kind, Idle);

    public List<string> Output(string kind) => [.. _output.GetValueOrDefault(kind, [])];

    public JobState MarkGenerating(string kind)
    {
        if (Get(kind).State == "generating") return Get(kind);
        _output[kind] = [];
        return _jobs[kind] = new JobState("generating", null);
    }

    public JobState MarkDone(string kind, string? error) => _jobs[kind] = error is null ? Idle : new JobState("error", error);

    public JobState Stop(string kind) => _jobs[kind] = Idle;
}
