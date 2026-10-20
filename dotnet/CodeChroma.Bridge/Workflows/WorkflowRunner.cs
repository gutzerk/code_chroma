using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Workflows;

/// <summary>A gate the step agent's output reader awaits between events: closing it holds the step without killing its process.</summary>
public sealed class PauseGate
{
    private readonly object _lock = new();
    private volatile TaskCompletionSource? _closed;

    public void Close()
    {
        lock (_lock) _closed ??= new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    }

    public void Open()
    {
        TaskCompletionSource? closed;
        lock (_lock) { closed = _closed; _closed = null; }
        closed?.TrySetResult();
    }

    public Task WaitAsync(CancellationToken token)
    {
        var closed = _closed;
        return closed is null ? Task.CompletedTask : closed.Task.WaitAsync(token);
    }
}

/// <summary>Drives one repo's workflow runs: a sequential loop over a SkillAgent per step, one git worktree per run, and the steer commands.</summary>
public sealed partial class WorkflowRunner
{
    private const int MaxOutputChars = 200_000;
    private const long OutputSaveIntervalMs = 1000;
    private static readonly string[] ActiveStates = [RunStates.Running, RunStates.Paused, RunStates.Stopping];

    private readonly string _repoRoot;
    private readonly SkillAgent _agent;
    private readonly Action<JsonObject> _emit;
    private readonly SkillAgent? _chat;
    private readonly Func<string, string?>? _mcpUrl;
    private readonly Func<string, string?> _sessionFinder;
    private readonly object _lock = new();
    private readonly Dictionary<string, Handle> _handles = [];

    private sealed class Handle(Run run, WorkflowDef def, string worktree)
    {
        public Run Run { get; } = run;
        public WorkflowDef Def { get; } = def;
        public string Worktree { get; } = worktree;
        public PauseGate Gate { get; set; } = new();
        public TaskCompletionSource StopSignal { get; set; } = NewSignal();
        public Task Loop { get; set; } = Task.CompletedTask;
        public bool StopRequested { get; set; }
        public string? Bypass { get; set; }
        public string? Rerun { get; set; }
        public string? Note { get; set; }
        public long LastSave { get; set; }
        public string McpToken { get; } = Guid.NewGuid().ToString("N");
    }

    private enum Outcome { Completed, Failed, Stopped }

    public WorkflowRunner(string repoRoot, SkillAgent agent, Action<JsonObject> emit, Func<string, string?>? sessionFinder = null,
        SkillAgent? chatAgent = null, Func<string, string?>? mcpUrl = null)
    {
        _repoRoot = repoRoot;
        _chat = chatAgent;
        _mcpUrl = mcpUrl;
        _agent = agent;
        _emit = emit;
        _sessionFinder = sessionFinder ?? (worktree => Transcripts.FindSessionId(worktree));
        Store = new RunStore(repoRoot);
        Recover();
    }

    public RunStore Store { get; }

    private static readonly HashSet<char> InvalidMarkerChars = [.. Path.GetInvalidFileNameChars(), '\\', ':'];

    /// <summary>The scratch file a chat agent is pointed at as its artifact; it lives outside the repo so no rollback touches the code.</summary>
    public static string Marker(string prefix, string key) =>
        Path.Combine(Path.GetTempPath(), "codechroma-workflow-steps", new string($"{prefix}-{key}".Select(c => InvalidMarkerChars.Contains(c) ? '_' : c).ToArray()) + ".json");

    private static void WriteMarker(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, "{}");
    }

    public static string WorktreeFor(string repoRoot, string runId) => WorktreeOps.WorktreePath(repoRoot, "wf-" + runId);

    private static TaskCompletionSource NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <summary>A run left running, paused or stopping by a bridge restart has no agent any more, so it becomes stopped.</summary>
    private void Recover()
    {
        foreach (var run in Store.ListRuns().Where(r => ActiveStates.Contains(r.State)))
        {
            run.State = RunStates.Stopped;
            foreach (var step in run.Steps.Where(s => s.Status is "running" or "paused" or "stopping")) step.Status = "stopped";
            Store.Save(run);
        }
    }

    public List<Run> List()
    {
        lock (_lock)
        {
            var runs = new List<Run>();
            foreach (var id in Store.RunIds())
            {
                if (_handles.TryGetValue(id, out var h)) runs.Add(Clone(h.Run));
                else if (Store.GetRun(id) is { } saved) runs.Add(saved);
            }
            return runs;
        }
    }

    public Run Get(string runId)
    {
        lock (_lock) return Clone(Require(runId).Run);
    }

    /// <summary>Completes when the run's current driving loop has parked or finished.</summary>
    public Task Idle(string runId)
    {
        lock (_lock) return Require(runId).Loop;
    }

    public async Task<Run> Start(string workflowId)
    {
        var def = Store.GetWorkflow(workflowId) ?? throw new BridgeException(404, $"unknown workflow: {workflowId}");
        if (def.Steps.Count == 0) throw new BridgeException(409, "the workflow has no steps");
        var runId = "run-" + Guid.NewGuid().ToString("N")[..10];
        var branch = "workflow/" + runId;
        var worktree = WorktreeFor(_repoRoot, runId);
        await Task.Run(() => WorktreeOps.Add(_repoRoot, branch, worktree));
        var run = new Run
        {
            Id = runId, WorkflowId = def.Id, State = RunStates.Running, CurrentStepId = def.Steps[0].Id, Attempt = 1,
            Attempts = [new RunAttempt { N = 1, Branch = branch }],
            Steps = def.Steps.Select(s => new StepRecord { StepId = s.Id, Attempt = 1, Status = "pending" }).ToList(),
        };
        lock (_lock)
        {
            var handle = new Handle(run, def, worktree);
            _handles[runId] = handle;
            Store.Save(run);
            Drive(handle, 0);
        }
        return Get(runId);
    }

    public Run Pause(string runId) => Command(runId, "run.paused", h =>
    {
        Transition(h, RunCommand.Pause);
        h.Gate.Close();
        SetCurrentStatus(h, "paused", from: "running");
    });

    public Run Resume(string runId)
    {
        lock (_lock)
        {
            var h = Require(runId);
            if (h.Run.State == RunStates.Held) return ResumeHeld(h);
            Transition(h, RunCommand.Resume);
            SetCurrentStatus(h, "running", from: "paused");
            h.Gate.Open();
            Persist(h, "run.resumed");
            return Clone(h.Run);
        }
    }

    public Run ResumeFrom(string runId, string stepId)
    {
        lock (_lock)
        {
            var h = Require(runId);
            if (!RunStateMachine.IsLegal(h.Run.State, RunCommand.ResumeFrom)) throw Illegal(h, "resume-from");
            if (h.Run.CurrentStepId != stepId) throw new BridgeException(409, "a run can only resume from its current step; use redo for earlier steps");
            return ResumeHeld(h);
        }
    }

    private Run ResumeHeld(Handle h)
    {
        Transition(h, RunCommand.ResumeFrom);
        h.Bypass = h.Run.CurrentStepId;
        var index = IndexOf(h, h.Run.CurrentStepId!);
        Persist(h, "run.resumed");
        Drive(h, index);
        return Clone(h.Run);
    }

    public async Task<Run> Stop(string runId, string mode)
    {
        if (mode == "afterStep")
        {
            return Command(runId, "run.step", h =>
            {
                Transition(h, RunCommand.StopAfter);
                h.Run.StopAfter = h.Run.CurrentStepId;
            });
        }
        if (mode != "now") throw new BridgeException(400, "mode must be now or afterStep");
        Handle handle;
        lock (_lock)
        {
            handle = Require(runId);
            var before = handle.Run.State;
            Transition(handle, RunCommand.StopNow);
            if (handle.Run.State == RunStates.Stopped)
            {
                SetCurrentStatus(handle, "stopped");
                Persist(handle, "run.stopped");
                return Clone(handle.Run);
            }
            SetCurrentStatus(handle, "stopping", from: before == RunStates.Paused ? "paused" : "running");
            handle.StopRequested = true;
            Persist(handle, "run.stopping");
            handle.StopSignal.TrySetResult();
            handle.Gate.Open();
        }
        await _agent.Stop(runId);
        await handle.Loop;
        return Get(runId);
    }

    public Run KeepRunning(string runId) => Command(runId, "run.step", h => h.Run.StopAfter = null);

    public Run SetBreakpoint(string runId, string stepId, bool on) => Command(runId, "run.step", h =>
    {
        var record = h.Run.Steps.FirstOrDefault(s => s.StepId == stepId) ?? throw new BridgeException(404, $"unknown step: {stepId}");
        if (on)
        {
            if (record.Status != "pending") throw new BridgeException(409, "a breakpoint can only be set on a step that has not started");
            if (!h.Run.Breakpoints.Contains(stepId)) h.Run.Breakpoints.Add(stepId);
        }
        else
        {
            h.Run.Breakpoints.Remove(stepId);
        }
    });

    public Run Review(string runId, string decision, string? note)
    {
        lock (_lock)
        {
            var h = Require(runId);
            if (h.Run.State != RunStates.NeedsYou) throw Illegal(h, "review");
            var index = IndexOf(h, h.Run.CurrentStepId!);
            var review = Record(h, h.Run.CurrentStepId!);
            if (decision == "approve")
            {
                review.Status = "done";
                if (index == h.Def.Steps.Count - 1)
                {
                    Transition(h, RunCommand.ApproveLast);
                    h.Run.CurrentStepId = null;
                    Persist(h, "run.done");
                    return Clone(h.Run);
                }
                Transition(h, RunCommand.Approve);
                Persist(h, "run.step");
                Drive(h, index + 1);
                return Clone(h.Run);
            }
            if (decision != "sendBack") throw new BridgeException(400, "decision must be approve or sendBack");
            var target = Enumerable.Range(0, index).Reverse().FirstOrDefault(i => h.Def.Steps[i].Kind == "agent", -1);
            if (target < 0) throw new BridgeException(409, "there is no earlier agent step to send back to");
            Transition(h, RunCommand.SendBack);
            review.Status = "pending";
            var step = h.Def.Steps[target];
            h.Rerun = step.Id;
            h.Note = string.IsNullOrWhiteSpace(note) ? "Please revise your work." : note;
            AppendOutput(Record(h, step.Id), $"\n--- sent back: {h.Note} ---\n");
            Persist(h, "run.step");
            Drive(h, target);
            return Clone(h.Run);
        }
    }

    private Run Command(string runId, string eventName, Action<Handle> body)
    {
        lock (_lock)
        {
            var h = Require(runId);
            body(h);
            Persist(h, eventName);
            return Clone(h.Run);
        }
    }

    private Handle Require(string runId)
    {
        if (_handles.TryGetValue(runId, out var existing)) return existing;
        var run = Store.GetRun(runId) ?? throw new BridgeException(404, $"unknown run: {runId}");
        var def = Store.GetWorkflow(run.WorkflowId) ?? throw new BridgeException(409, $"the workflow {run.WorkflowId} no longer exists");
        foreach (var (stepId, prompt) in run.PromptOverrides)
            if (def.Steps.Find(x => x.Id == stepId) is { } overridden) overridden.Prompt = prompt;
        return _handles[runId] = new Handle(run, def, WorktreeFor(_repoRoot, runId));
    }

    private static BridgeException Illegal(Handle h, string command) => new(409, $"cannot {command} a run that is {h.Run.State}");

    private static void Transition(Handle h, RunCommand command) =>
        h.Run.State = RunStateMachine.TryApply(h.Run.State, command) ?? throw Illegal(h, command.ToString());

    private static int IndexOf(Handle h, string stepId) => h.Def.Steps.FindIndex(s => s.Id == stepId);

    private static StepRecord Record(Handle h, string stepId)
    {
        var record = h.Run.Steps.Find(s => s.StepId == stepId);
        if (record is not null) return record;
        record = new StepRecord { StepId = stepId, Attempt = h.Run.Attempt };
        h.Run.Steps.Add(record);
        return record;
    }

    /// <summary>Moves the current step to a status: only from `from` when given, otherwise from anything but done.</summary>
    private static void SetCurrentStatus(Handle h, string to, string? from = null)
    {
        if (h.Run.CurrentStepId is not { } id) return;
        var record = Record(h, id);
        if (from is null ? record.Status != "done" : record.Status == from) record.Status = to;
    }

    private static void AppendOutput(StepRecord record, string text)
    {
        var joined = record.Output.Length == 0 || text.StartsWith('\n') ? record.Output + text : record.Output + "\n" + text;
        record.Output = joined.Length > MaxOutputChars ? joined[^MaxOutputChars..] : joined;
    }

    private void Persist(Handle h, string eventName)
    {
        Store.Save(h.Run);
        h.LastSave = Environment.TickCount64;
        Emit(h, eventName);
    }

    /// <summary>Output flushes always notify the canvas but save at most once per second; every state change saves in full.</summary>
    private void PersistOutput(Handle h)
    {
        if (Environment.TickCount64 - h.LastSave >= OutputSaveIntervalMs) Persist(h, "run.step");
        else Emit(h, "run.step");
    }

    private void Emit(Handle h, string eventName) => _emit(new JsonObject { ["type"] = "run", ["runId"] = h.Run.Id, ["event"] = eventName });

    private static Run Clone(Run run) => JsonSerializer.Deserialize<Run>(JsonSerializer.Serialize(run, WorkflowJson.Options), WorkflowJson.Options)!;

    private void Drive(Handle h, int index)
    {
        h.StopRequested = false;
        h.Gate = new PauseGate();
        h.StopSignal = NewSignal();
        var previous = h.Loop;
        h.Loop = Task.Run(async () =>
        {
            await previous;
            await LoopAsync(h, index);
        });
    }

    private async Task LoopAsync(Handle h, int index)
    {
        try
        {
            for (var i = index; i < h.Def.Steps.Count; i++)
            {
                var step = h.Def.Steps[i];
                lock (_lock) h.Run.CurrentStepId = step.Id;
                await h.Gate.WaitAsync(CancellationToken.None);
                if (h.StopRequested) { FinishStop(h); return; }

                var parked = false;
                bool rerun;
                lock (_lock)
                {
                    var record = Record(h, step.Id);
                    var bypass = h.Bypass == step.Id;
                    h.Bypass = null;
                    rerun = h.Rerun == step.Id || record.Status == "stopped";
                    if (h.Rerun == step.Id) h.Rerun = null;
                    if (!bypass && !rerun && h.Run.Breakpoints.Contains(step.Id) && record.Status == "pending")
                    {
                        Transition(h, RunCommand.ReachBreakpoint);
                        record.Status = "held";
                        Persist(h, "run.held");
                        parked = true;
                    }
                    else if (step.Kind == "review")
                    {
                        Transition(h, RunCommand.ReviewStep);
                        record.Status = "needs_you";
                        Persist(h, "run.step");
                        parked = true;
                    }
                    else
                    {
                        record.Status = "running";
                        Persist(h, "run.step");
                    }
                }
                if (parked) return;

                var outcome = await RunAgentStep(h, step, rerun);
                if (outcome == Outcome.Stopped) { FinishStop(h); return; }
                await h.Gate.WaitAsync(CancellationToken.None);
                if (h.StopRequested) { FinishStop(h); return; }
                if (outcome == Outcome.Failed) { FailRun(h, step); return; }
                if (CompleteStep(h, i)) return;
            }
        }
        catch (Exception error)
        {
            lock (_lock)
            {
                if (h.Run.CurrentStepId is { } id)
                {
                    var record = Record(h, id);
                    AppendOutput(record, "✗ " + error.Message);
                    record.Status = "stopped";
                }
                h.Run.State = RunStates.Stopped;
                Persist(h, "run.stopped");
            }
        }
    }

    /// <summary>The worktree diff stat and CLI session id, read outside the lock because they shell out.</summary>
    private (string? Diff, string? Session) Capture(Handle h) => (DiffStat(h.Worktree), _sessionFinder(h.Worktree));

    private static void Snapshot(StepRecord record, string status, (string? Diff, string? Session) stats)
    {
        record.Status = status;
        record.DiffStat = stats.Diff;
        record.SessionId = stats.Session ?? record.SessionId;
    }

    /// <summary>Marks the step done and moves the run on; true when the loop must end (held or finished).</summary>
    private bool CompleteStep(Handle h, int index)
    {
        var step = h.Def.Steps[index];
        var stats = Capture(h);
        lock (_lock)
        {
            Snapshot(Record(h, step.Id), "done", stats);
            if (index == h.Def.Steps.Count - 1)
            {
                Transition(h, RunCommand.FinishAll);
                h.Run.CurrentStepId = null;
                h.Run.StopAfter = null;
                Persist(h, "run.done");
                return true;
            }
            if (h.Run.StopAfter == step.Id)
            {
                Transition(h, RunCommand.StepEndHeld);
                var next = h.Def.Steps[index + 1];
                h.Run.StopAfter = null;
                h.Run.CurrentStepId = next.Id;
                Record(h, next.Id).Status = "held";
                Persist(h, "run.held");
                return true;
            }
            Persist(h, "run.step");
            return false;
        }
    }

    private void FailRun(Handle h, WorkflowStep step)
    {
        var stats = Capture(h);
        lock (_lock)
        {
            Snapshot(Record(h, step.Id), "stopped", stats);
            h.Run.State = RunStates.Stopped;
            Persist(h, "run.stopped");
        }
    }

    /// <summary>The partial diff stays uncommitted in the worktree; only the record and state change.</summary>
    private void FinishStop(Handle h)
    {
        var stats = Capture(h);
        lock (_lock)
        {
            if (h.Run.CurrentStepId is { } id && Record(h, id) is { Status: "running" or "paused" or "stopping" } record) Snapshot(record, "stopped", stats);
            if (h.Run.State == RunStates.Stopping) Transition(h, RunCommand.StopComplete);
            h.Run.StopAfter = null;
            Persist(h, "run.stopped");
        }
    }

    private async Task<Outcome> RunAgentStep(Handle h, WorkflowStep step, bool rerun)
    {
        StepRecord record;
        string? session;
        lock (_lock)
        {
            record = Record(h, step.Id);
            session = record.SessionId;
        }
        if (record.CheckpointRef is null)
        {
            var checkpoint = Checkpoint(h.Worktree, step.Slug);
            lock (_lock) record.CheckpointRef = checkpoint;
        }
        var prompt = BuildPrompt(step, rerun, session is not null, h.Note);
        h.Note = null;
        IReadOnlyList<string> extra = rerun && session is not null ? ["--resume", session] : [];
        var done = new TaskCompletionSource<JobState>(TaskCreationOptions.RunContinuationsAsynchronously);
        var gate = h.Gate;
        JobState started;
        try
        {
            started = await _agent.Start(
                h.Run.Id, h.Worktree,
                (_, state) => { if (state.State != "generating") done.TrySetResult(state); return Task.CompletedTask; },
                (_, lines) => { OnLines(h, record, lines); return Task.CompletedTask; },
                prompt, null, new RunOptions(extra) { PauseGate = gate.WaitAsync, Bare = false });
        }
        catch (Exception error)
        {
            lock (_lock) AppendOutput(record, "✗ " + error.Message);
            return Outcome.Failed;
        }
        if (started.State != "generating") done.TrySetResult(started);
        var finished = await Task.WhenAny(done.Task, h.StopSignal.Task);
        if (finished != done.Task) return Outcome.Stopped;
        var result = await done.Task;
        if (result.State == "idle") return Outcome.Completed;
        lock (_lock) AppendOutput(record, "✗ " + result.Error);
        return Outcome.Failed;
    }

    private void OnLines(Handle h, StepRecord record, IReadOnlyList<string> lines)
    {
        lock (_lock)
        {
            foreach (var line in lines) AppendOutput(record, line);
            PersistOutput(h);
        }
    }

    private static string BuildPrompt(WorkflowStep step, bool rerun, bool hasSession, string? note)
    {
        if (!rerun) return step.Prompt;
        if (note is not null) return $"Reviewer feedback: {note}\n\nAddress it. The original task of this step:\n{step.Prompt}";
        var lead = hasSession
            ? "Your previous attempt at this step was interrupted. Continue and finish it."
            : "A previous attempt at this step was interrupted; its partial changes are in the working tree. Finish the step.";
        return $"{lead}\n\n{step.Prompt}";
    }

    private static string? Checkpoint(string worktree, string slug) => WorktreeOps.CommitAll(worktree, $"workflow checkpoint before {slug}");

    private static string? DiffStat(string worktree)
    {
        GitRunner.RunRaw(worktree, "add", "-N", "-A");
        var stat = GitRunner.Run(worktree, "diff", "--shortstat", "HEAD")?.Trim();
        return string.IsNullOrEmpty(stat) ? null : stat;
    }
}
