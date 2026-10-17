using System.Text.Json;
using System.Text.Json.Serialization;

namespace CodeChroma.Canvas.Tracing;

public sealed record TraceError(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("message")] string Message,
    [property: JsonPropertyName("handled")] bool Handled);

/// <summary>One captured step of a recorded run (the wire shape of GET /repos/{id}/traces/{id}).</summary>
public sealed record TraceFrame
{
    [JsonPropertyName("seq")] public int Seq { get; init; }
    [JsonPropertyName("node_id")] public string? NodeId { get; init; }
    [JsonPropertyName("event")] public string Event { get; init; } = "call";
    [JsonPropertyName("depth")] public int Depth { get; init; }
    [JsonPropertyName("caller_node_id")] public string? CallerNodeId { get; init; }
    [JsonPropertyName("error")] public TraceError? Error { get; init; }

    public bool IsErrorFrame => Event is "raise" or "unwind" || Error is not null;
}

public sealed class Trace
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("entry")] public string Entry { get; set; } = "";
    [JsonPropertyName("created_at")] public string CreatedAt { get; set; } = "";
    [JsonPropertyName("status")] public string Status { get; set; } = "ok";
    [JsonPropertyName("steps")] public List<TraceFrame> Steps { get; set; } = new();

    public static Trace Parse(string json)
    {
        var trace = JsonSerializer.Deserialize<Trace>(json) ?? new Trace();
        trace.Steps ??= new List<TraceFrame>();
        return trace;
    }
}

public sealed record TraceSummary(string Id, string Entry, string Status, int StepCount);

/// <summary>Schedules the player's next tick; the app uses a UI timer, tests use a manual clock.</summary>
public interface ITraceScheduler
{
    IDisposable After(TimeSpan delay, Action action);
}

/// <summary>
/// Execution-trace playback (port of traceStore.ts): active trace, current step, play/scrub/speed/breakpoints. Playback
/// advances on a timer and pauses at the end, on a breakpoint node, or on a failed trace's culprit raise frame; a live
/// run appends streamed frames and refuses scrubbing until it ends.
/// </summary>
public sealed class TracePlayer
{
    public const double BaseStepMs = 700;

    private readonly ITraceScheduler _scheduler;
    private readonly HashSet<string> _breakpoints = new();
    private IDisposable? _timer;
    private int _culprit = -1;

    public TracePlayer(ITraceScheduler scheduler) => _scheduler = scheduler;

    public event Action? Changed;

    public Trace? Trace { get; private set; }
    public int StepIndex { get; private set; }
    public bool IsPlaying { get; private set; }
    public bool IsActive { get; private set; }
    public bool IsLive { get; private set; }
    public bool FollowCamera { get; private set; } = true;
    public double Speed { get; private set; } = 1;
    public IReadOnlyCollection<string> Breakpoints => _breakpoints;
    public IReadOnlyList<TraceFrame> Steps => (IReadOnlyList<TraceFrame>?)Trace?.Steps ?? Array.Empty<TraceFrame>();
    public TraceFrame? CurrentFrame => StepIndex >= 0 && StepIndex < Steps.Count ? Steps[StepIndex] : null;

    public void Activate()
    {
        IsActive = true;
        Changed?.Invoke();
    }

    public void LoadTrace(Trace trace)
    {
        StopTimer();
        trace.Steps ??= new List<TraceFrame>();
        Trace = trace;
        StepIndex = 0;
        IsPlaying = false;
        IsActive = true;
        IsLive = false;
        RecomputeCulprit();
        Changed?.Invoke();
    }

    public void EnsureLive(string id, string entry = "")
    {
        if (!IsLive) StartLive(id, entry);
    }

    public void StartLive(string id, string entry = "")
    {
        StopTimer();
        Trace = new Trace { Id = id, Entry = entry };
        StepIndex = 0;
        IsPlaying = false;
        IsActive = true;
        IsLive = true;
        _culprit = -1;
        Changed?.Invoke();
    }

    public void AppendStep(TraceFrame frame)
    {
        if (Trace is null || !IsLive) return;
        Trace.Steps.Add(frame);
        StepIndex = Trace.Steps.Count - 1;
        if (frame.Error is { Handled: false }) Trace.Status = "failed";
        RecomputeCulprit();
        Changed?.Invoke();
    }

    public void EndLive(string status)
    {
        if (Trace is null) return;
        Trace.Status = status;
        IsLive = false;
        RecomputeCulprit();
        Changed?.Invoke();
    }

    public void Clear()
    {
        StopTimer();
        Trace = null;
        StepIndex = 0;
        IsPlaying = false;
        IsActive = false;
        IsLive = false;
        _culprit = -1;
        Changed?.Invoke();
    }

    public void StepForward() => ScrubTo(StepIndex + 1);
    public void StepBack() => ScrubTo(StepIndex - 1);

    public void ScrubTo(int index)
    {
        if (IsLive) return;
        StepIndex = Clamp(index);
        Changed?.Invoke();
    }

    public void SetSpeed(double speed)
    {
        Speed = speed;
        if (IsPlaying) ScheduleTick();
        Changed?.Invoke();
    }

    public void SetFollowCamera(bool follow)
    {
        FollowCamera = follow;
        Changed?.Invoke();
    }

    public void ToggleBreakpoint(string nodeId)
    {
        if (!_breakpoints.Remove(nodeId)) _breakpoints.Add(nodeId);
        Changed?.Invoke();
    }

    public void Play()
    {
        if (IsLive) return;
        var last = Steps.Count - 1;
        if (last < 0) return;
        if (StepIndex >= last) StepIndex = 0;
        IsPlaying = true;
        ScheduleTick();
        Changed?.Invoke();
    }

    public void Pause()
    {
        IsPlaying = false;
        StopTimer();
        Changed?.Invoke();
    }

    public void TogglePlay()
    {
        if (IsPlaying) Pause();
        else Play();
    }

    /// <summary>The live call stack at a step, rebuilt by replaying call / return / unwind frames.</summary>
    public static IReadOnlyList<(string NodeId, int Depth)> CallStackAt(IReadOnlyList<TraceFrame> steps, int stepIndex)
    {
        var stack = new List<(string NodeId, int Depth)>();
        for (var i = 0; i <= stepIndex && i < steps.Count; i++)
        {
            var step = steps[i];
            if (step.NodeId is null) continue;
            if (step.Event == "call") stack.Add((step.NodeId, step.Depth));
            else if (step.Event is "return" or "unwind")
            {
                var idx = stack.FindLastIndex(e => e.NodeId == step.NodeId);
                if (idx >= 0) stack.RemoveAt(idx);
            }
        }
        return stack;
    }

    /// <summary>Back to a pristine player (workspace switch): breakpoints, speed and follow reset too.</summary>
    public void Reset()
    {
        _breakpoints.Clear();
        FollowCamera = true;
        Speed = 1;
        Clear();
    }

    private int Clamp(int index)
    {
        var last = Steps.Count - 1;
        return last < 0 ? 0 : Math.Min(Math.Max(index, 0), last);
    }

    private void RecomputeCulprit()
    {
        _culprit = -1;
        if (Trace?.Status != "failed" || Steps.Count == 0) return;
        for (var i = Steps.Count - 1; i >= 0; i--)
            if (Steps[i].Event == "raise") { _culprit = i; return; }
        _culprit = Steps.Count - 1;
    }

    private void ScheduleTick()
    {
        StopTimer();
        _timer = _scheduler.After(TimeSpan.FromMilliseconds(BaseStepMs / Speed), Tick);
    }

    private void Tick()
    {
        var last = Steps.Count - 1;
        var next = StepIndex + 1;
        if (last < 0 || next > last) { Pause(); return; }
        StepIndex = next;
        var frame = Steps[next];
        if ((frame.NodeId is not null && _breakpoints.Contains(frame.NodeId)) || (_culprit >= 0 && next >= _culprit))
        {
            Pause();
            return;
        }
        Changed?.Invoke();
        ScheduleTick();
    }

    private void StopTimer()
    {
        _timer?.Dispose();
        _timer = null;
    }
}

public sealed record TraceNodeMark(string NodeId, Rect Frame, bool Active, bool Error);

public sealed record TraceEdgeMark(string CallerId, string CalleeId, Point From, Point To, bool Active, bool Error);

/// <summary>
/// Where the trace flow draws for the current step (port of TraceFlowOverlay.tsx): the callee's visible block is framed, the
/// caller-to-callee edge runs border to border, and five prior steps trail behind. Endpoints snap to the nearest block that is
/// actually on screen, so a collapsed target routes block to block and an expanded one function to function.
/// </summary>
public static class TraceFlow
{
    public const int Trail = 5;
    public const double FramePadding = 4;

    public static (IReadOnlyList<TraceNodeMark> Nodes, IReadOnlyList<TraceEdgeMark> Edges) Compute(
        Trace? trace, int stepIndex, Func<string, string> nearestVisible, Func<string, Rect?> headerRectOf)
    {
        var nodes = new List<TraceNodeMark>();
        var edges = new List<TraceEdgeMark>();
        if (trace is null || trace.Steps.Count == 0) return (nodes, edges);
        var seen = new HashSet<string>();
        for (var i = Math.Max(0, stepIndex - Trail); i <= stepIndex && i < trace.Steps.Count; i++)
        {
            var step = trace.Steps[i];
            if (step.NodeId is null) continue;
            var active = i == stepIndex;
            var calleeId = nearestVisible(step.NodeId);
            if (headerRectOf(calleeId) is not { } callee) continue;
            if (seen.Add(calleeId) || active)
                nodes.Add(new TraceNodeMark(calleeId, new Rect(callee.Left - FramePadding, callee.Top - FramePadding, callee.Width + 2 * FramePadding, callee.Height + 2 * FramePadding), active, step.IsErrorFrame));
            if (step.CallerNodeId is null) continue;
            var callerId = nearestVisible(step.CallerNodeId);
            if (callerId == calleeId || headerRectOf(callerId) is not { } caller) continue;
            var (from, to) = BorderSegment(caller, callee);
            edges.Add(new TraceEdgeMark(callerId, calleeId, from, to, active, step.IsErrorFrame));
        }
        return (nodes, edges);
    }

    /// <summary>The border-to-border segment: on each box, the point nearest the other's centre.</summary>
    public static (Point From, Point To) BorderSegment(Rect a, Rect b) => (
        new Point(Math.Clamp(b.CenterX, a.Left, a.Right), Math.Clamp(b.CenterY, a.Top, a.Bottom)),
        new Point(Math.Clamp(a.CenterX, b.Left, b.Right), Math.Clamp(a.CenterY, b.Top, b.Bottom)));
}
