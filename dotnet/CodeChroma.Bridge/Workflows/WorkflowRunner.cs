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
    private const int ContextTailChars = 4000;
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
    private readonly HashSet<string> _chatBusy = [];

    private sealed class Handle(Run run, WorkflowDef def, string worktree)
    {
        public Run Run { get; } = run;
        public WorkflowDef Def { get; } = def;
        public string Worktree { get; } = worktree;
        public PauseGate Gate { get; set; } = new();
        public TaskCompletionSource StopSignal { get; set; } = NewSignal();
        public Task Loop { get; set; } = Task.CompletedTask;
        public bool StopRequested { get; set; }
        public volatile bool Busy;
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

    /// <summary>Deletes a workflow definition; a run still in progress blocks it.</summary>
    public void DeleteWorkflow(string workflowId)
    {
        if (Store.GetWorkflow(workflowId) is null) throw new BridgeException(404, $"unknown workflow: {workflowId}");
        if (List().Any(r => r.WorkflowId == workflowId && r.State is RunStates.Running or RunStates.Paused or RunStates.Stopping or RunStates.Held or RunStates.NeedsYou))
            throw new BridgeException(409, "the workflow has a run in progress; stop it first");
        Store.DeleteWorkflow(workflowId);
    }

    /// <summary>Removes a done or stopped run: its record, worktree and branches (the git cleanup is best-effort and runs outside the lock).</summary>
    public void DeleteRun(string runId)
    {
        string id;
        lock (_lock)
        {
            id = runId;
            if (_handles.TryGetValue(runId, out var h))
            {
                if (h.Busy || !RunStates.IsFinished(h.Run.State)) throw new BridgeException(409, $"cannot delete a run that is {h.Run.State}");
                Detach(runId, h);
            }
            else
            {
                var saved = Store.GetRun(runId) ?? throw new BridgeException(404, $"unknown run: {runId}");
                if (!RunStates.IsFinished(saved.State)) throw new BridgeException(409, $"cannot delete a run that is {saved.State}");
                Detach(runId, null);
            }
        }
        WipeGit(id, WorktreeFor(_repoRoot, id));
    }

    /// <summary>Removes every done or stopped run and returns their ids.</summary>
    public List<string> ClearFinished()
    {
        var victims = new List<string>();
        lock (_lock)
        {
            foreach (var id in Store.RunIds())
            {
                if (_handles.TryGetValue(id, out var h))
                {
                    if (h.Busy || !RunStates.IsFinished(h.Run.State)) continue;
                    Detach(id, h);
                }
                else
                {
                    if (Store.GetRun(id) is not { } saved || !RunStates.IsFinished(saved.State)) continue;
                    Detach(id, null);
                }
                victims.Add(id);
            }
        }
        foreach (var id in victims) WipeGit(id, WorktreeFor(_repoRoot, id));
        return victims;
    }

    /// <summary>Drops the run's handle and record and announces it; the caller wipes git outside the lock.</summary>
    private void Detach(string id, Handle? h)
    {
        if (h is not null) h.Busy = true;
        _handles.Remove(id);
        Store.DeleteRun(id);
        _emit(new JsonObject { ["type"] = "run", ["runId"] = id, ["event"] = "run.deleted" });
    }

    /// <summary>Best-effort removal of the run worktree and its workflow/ and attempt branches.</summary>
    private void WipeGit(string id, string worktree)
    {
        try { WorktreeOps.Remove(_repoRoot, worktree, force: true); } catch (Exception) { }
        try { if (Directory.Exists(worktree)) Directory.Delete(worktree, true); } catch (Exception) { }
        try { WorktreeOps.Prune(_repoRoot); } catch (Exception) { }
        var listed = GitRunner.Run(_repoRoot, "branch", "--list", "--format=%(refname:short)", $"workflow/{id}", $"{id}/attempt-*") ?? "";
        foreach (var branch in listed.Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(b => b.Trim()).Where(b => b.Length > 0))
            try { WorktreeOps.DeleteBranch(_repoRoot, branch); } catch (Exception) { }
    }

    /// <summary>Wipes a finished run's attempt (worktree, branches, outputs, messages) and starts the same run again from step one.</summary>
    public async Task<Run> Restart(string runId)
    {
        Handle h;
        lock (_lock)
        {
            h = Require(runId);
            if (h.Busy || !RunStates.IsFinished(h.Run.State)) throw Illegal(h, "restart");
        }
        await h.Loop;
        lock (_lock)
        {
            if (h.Busy || !RunStates.IsFinished(h.Run.State)) throw Illegal(h, "restart");
            h.Busy = true;
        }
        var branch = "workflow/" + runId;
        try
        {
            await Task.Run(() =>
            {
                WipeGit(runId, h.Worktree);
                WorktreeOps.Add(_repoRoot, branch, h.Worktree);
            });
        }
        catch
        {
            lock (_lock) h.Busy = false;
            throw;
        }
        lock (_lock)
        {
            h.Busy = false;
            // A restart picks up the stored definition, so edits made since the run began apply.
            var def = Store.GetWorkflow(h.Run.WorkflowId) ?? h.Def;
            var run = NewRun(runId, def, branch, h.Run.Inputs);
            var fresh = new Handle(run, def, h.Worktree);
            _handles[runId] = fresh;
            Store.Save(run);
            Emit(fresh, "run.step");
            Drive(fresh, 0);
            return Clone(run);
        }
    }

    private static Run NewRun(string runId, WorkflowDef def, string branch, Dictionary<string, string> inputs) => new()
    {
        Id = runId, WorkflowId = def.Id, State = RunStates.Running, CurrentStepId = def.Steps[0].Id, Attempt = 1,
        Attempts = [new RunAttempt { N = 1, Branch = branch }],
        Steps = def.Steps.Select(s => new StepRecord { StepId = s.Id, Attempt = 1, Status = "pending" }).ToList(),
        Inputs = inputs, Breakpoints = PauseBeforeIds(def),
    };

    public async Task<Run> Start(string workflowId, IReadOnlyDictionary<string, string>? inputs = null)
    {
        var def = Store.GetWorkflow(workflowId) ?? throw new BridgeException(404, $"unknown workflow: {workflowId}");
        if (def.Steps.Count == 0) throw new BridgeException(409, "the workflow has no steps");
        var given = new Dictionary<string, string>();
        foreach (var input in def.AllInputs())
        {
            var value = inputs is not null && inputs.TryGetValue(input.Name, out var v) ? v.Trim() : "";
            if (value.Length == 0) throw new BridgeException(400, $"input is required: {(string.IsNullOrWhiteSpace(input.Label) ? input.Name : input.Label)}");
            given[input.Name] = value;
        }
        var runId = "run-" + Guid.NewGuid().ToString("N")[..10];
        var branch = "workflow/" + runId;
        var worktree = WorktreeFor(_repoRoot, runId);
        await Task.Run(() => WorktreeOps.Add(_repoRoot, branch, worktree));
        var run = NewRun(runId, def, branch, given);
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
                if (handle.Run.CurrentStepId is { } waiting && Record(handle, waiting) is { Status: "held" or "needs_you" } unstarted) unstarted.Status = "pending";
                else SetCurrentStatus(handle, "stopped");
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
                var nextIndex = NextIndex(h, index);
                if (nextIndex < 0)
                {
                    Transition(h, RunCommand.ApproveLast);
                    h.Run.CurrentStepId = null;
                    Persist(h, "run.done");
                    return Clone(h.Run);
                }
                Transition(h, RunCommand.Approve);
                Persist(h, "run.step");
                Drive(h, nextIndex);
                return Clone(h.Run);
            }
            if (decision != "sendBack") throw new BridgeException(400, "decision must be approve or sendBack");
            var configured = h.Def.Steps[index].SendBackTo;
            var target = configured is not null ? h.Def.Steps.FindIndex(0, index, x => x.Id == configured && x.Kind == "agent") : -1;
            if (target < 0) target = Enumerable.Range(0, index).Reverse().FirstOrDefault(i => h.Def.Steps[i].Kind == "agent", -1);
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

    private static void Transition(Handle h, RunCommand command)
    {
        if (h.Busy) throw new BridgeException(409, "the run is being redone; try again in a moment");
        h.Run.State = RunStateMachine.TryApply(h.Run.State, command) ?? throw Illegal(h, command.ToString());
    }

    /// <summary>Only the claude CLI takes the --resume/--tools/--strict-mcp-config flags the runner passes.</summary>
    private static bool IsClaude(SkillAgent agent)
    {
        try { return agent.ResolveCli().AdapterKey == "claude"; }
        catch (CliLookupException) { return false; }
    }

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
                lock (_lock)
                {
                    if (Record(h, step.Id).Status == "skipped") continue;
                    h.Run.CurrentStepId = step.Id;
                }
                bool parked, rerun;
                while (true)
                {
                    await h.Gate.WaitAsync(CancellationToken.None);
                    if (h.StopRequested) { FinishStop(h); return; }
                    if (TryBegin(h, step, out parked, out rerun)) break;
                }
                if (parked) return;

                var outcome = await RunAgentStep(h, step, rerun);
                if (outcome == Outcome.Stopped) { FinishStop(h); return; }
                bool? ended;
                while (true)
                {
                    await h.Gate.WaitAsync(CancellationToken.None);
                    if (h.StopRequested) { FinishStop(h); return; }
                    if (outcome == Outcome.Failed) { FailRun(h, step); return; }
                    ended = CompleteStep(h, i);
                    if (ended is not null) break;
                }
                if (ended == true) return;
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

    /// <summary>Starts or parks the step; false when a pause or stop landed since the gate check (the caller waits and tries again).</summary>
    private bool TryBegin(Handle h, WorkflowStep step, out bool parked, out bool rerun)
    {
        parked = false;
        rerun = false;
        lock (_lock)
        {
            if (h.Run.State != RunStates.Running) return false;
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
            return true;
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

    /// <summary>Marks the step done and moves the run on: true when the loop must end (held or finished), false to go on, null when a pause or stop landed first (the caller waits and tries again).</summary>
    private bool? CompleteStep(Handle h, int index)
    {
        var step = h.Def.Steps[index];
        var stats = Capture(h);
        lock (_lock)
        {
            if (h.Run.State != RunStates.Running) return null;
            Snapshot(Record(h, step.Id), "done", stats);
            var nextIndex = NextIndex(h, index);
            if (nextIndex < 0)
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
                var next = h.Def.Steps[nextIndex];
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
        var prompt = BuildPrompt(WithContext(h, step, ResolvePrompt(h, step), rerun), rerun, session is not null, h.Note);
        h.Note = null;
        IReadOnlyList<string> extra = rerun && session is not null && IsClaude(_agent) ? ["--resume", session] : [];
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

    /// <summary>The step prompt with the run's inputs filled in and its skill named first.</summary>
    private static string ResolvePrompt(Handle h, WorkflowStep step)
    {
        var prompt = step.Prompt;
        foreach (var (name, value) in h.Run.Inputs)
        {
            var ownedByOther = h.Def.Steps.Any(s => s.Id != step.Id && s.Input?.Name == name);
            if (!ownedByOther) prompt = prompt.Replace("{{" + name + "}}", value);
        }
        return string.IsNullOrWhiteSpace(step.Skill) ? prompt : $"Use the \"{step.Skill}\" skill for this step.\n\n{prompt}";
    }

    private static List<string> PauseBeforeIds(WorkflowDef def) => def.Steps.Where(s => s.PauseBefore).Select(s => s.Id).ToList();

    /// <summary>A "previous"-context first attempt gets the last finished step's output tail and diff stat ahead of its own prompt.</summary>
    private string WithContext(Handle h, WorkflowStep step, string prompt, bool rerun)
    {
        if (rerun || step.Context == "fresh") return prompt;
        string slug, output;
        string? diffStat;
        lock (_lock)
        {
            var index = IndexOf(h, step.Id);
            StepRecord? previous = null;
            var previousIndex = -1;
            for (var i = index - 1; i >= 0 && previous is null; i--)
            {
                var record = Record(h, h.Def.Steps[i].Id);
                if (record.Status == "skipped" || h.Def.Steps[i].Kind == "review") continue;
                previous = record;
                previousIndex = i;
            }
            if (previous is null) return prompt;
            slug = h.Def.Steps[previousIndex].Slug;
            output = previous.Output;
            diffStat = previous.DiffStat;
        }
        var sb = new System.Text.StringBuilder("Context from the previous step (" + slug + "):\n");
        if (output.Length > 0) sb.Append("Output tail:\n").Append(output.Length <= ContextTailChars ? output : "..." + output[^ContextTailChars..]).Append('\n');
        if (diffStat is not null) sb.Append("Changes: ").Append(diffStat).Append('\n');
        return sb.Append("\nYour task:\n").Append(prompt).ToString();
    }

    /// <summary>The next step after <paramref name="index"/> that has not been skipped, or -1.</summary>
    private static int NextIndex(Handle h, int index)
    {
        for (var i = index + 1; i < h.Def.Steps.Count; i++)
            if (Record(h, h.Def.Steps[i].Id).Status != "skipped") return i;
        return -1;
    }

    /// <summary>Skips a step that has not run: a later step is just marked, the parked current step also moves the run on.</summary>
    public Run Skip(string runId, string stepId)
    {
        lock (_lock)
        {
            var h = Require(runId);
            if (h.Busy) throw new BridgeException(409, "the run is being redone; try again in a moment");
            var record = h.Run.Steps.FirstOrDefault(s => s.StepId == stepId) ?? throw new BridgeException(404, $"unknown step: {stepId}");
            var index = IndexOf(h, stepId);
            if (h.Run.State == RunStates.Stopping) throw Illegal(h, "skip");
            if (h.Run.CurrentStepId != stepId)
            {
                if (record.Status != "pending") throw new BridgeException(409, "only a step that has not started can be skipped");
                record.Status = "skipped";
                h.Run.Breakpoints.Remove(stepId);
                Persist(h, "run.step");
                return Clone(h.Run);
            }
            if (h.Run.State is not (RunStates.Held or RunStates.NeedsYou or RunStates.Stopped) || record.Status is "done" or "skipped")
                throw new BridgeException(409, "stop the run at this step before skipping it");
            record.Status = "skipped";
            h.Run.Breakpoints.Remove(stepId);
            var nextIndex = NextIndex(h, index);
            if (nextIndex < 0)
            {
                h.Run.State = RunStates.Done;
                h.Run.CurrentStepId = null;
                h.Run.StopAfter = null;
                Persist(h, "run.done");
                return Clone(h.Run);
            }
            Transition(h, h.Run.State == RunStates.NeedsYou ? RunCommand.Approve : RunCommand.ResumeFrom);
            h.Run.CurrentStepId = h.Def.Steps[nextIndex].Id;
            Persist(h, "run.step");
            Drive(h, nextIndex);
            return Clone(h.Run);
        }
    }

    private static string BuildPrompt(string resolved, bool rerun, bool hasSession, string? note)
    {
        if (!rerun) return resolved;
        if (note is not null) return $"Reviewer feedback: {note}\n\nAddress it. The original task of this step:\n{resolved}";
        var lead = hasSession
            ? "Your previous attempt at this step was interrupted. Continue and finish it."
            : "A previous attempt at this step was interrupted; its partial changes are in the working tree. Finish the step.";
        return $"{lead}\n\n{resolved}";
    }

    private static string? Checkpoint(string worktree, string slug) => WorktreeOps.CommitAll(worktree, $"workflow checkpoint before {slug}");

    private static string? DiffStat(string worktree)
    {
        GitRunner.RunRaw(worktree, "add", "-N", "-A");
        var stat = GitRunner.Run(worktree, "diff", "--shortstat", "HEAD")?.Trim();
        return string.IsNullOrEmpty(stat) ? null : stat;
    }
}
