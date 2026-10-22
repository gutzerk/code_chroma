namespace CodeChroma.Bridge.Workflows;

/// <summary>The run states of the workflow contract, as the strings the wire carries.</summary>
public static class RunStates
{
    public const string Running = "running";
    public const string Paused = "paused";
    public const string Stopping = "stopping";
    public const string Held = "held";
    public const string Stopped = "stopped";
    public const string NeedsYou = "needs_you";
    public const string Done = "done";

    public static bool IsFinished(string state) => state is Done or Stopped;
}

public enum RunCommand
{
    Pause,
    Resume,
    StopNow,
    StopAfter,
    StopComplete,
    StepEndHeld,
    ReachBreakpoint,
    ReviewStep,
    Approve,
    ApproveLast,
    SendBack,
    ResumeFrom,
    FinishAll,
    Redo,
}

/// <summary>The pure transition table: an illegal state and command pair leaves the state unchanged.</summary>
public static class RunStateMachine
{
    public static string Apply(string state, RunCommand command) => TryApply(state, command) ?? state;

    public static bool IsLegal(string state, RunCommand command) => TryApply(state, command) is not null;

    /// <summary>The next state, or null when the command is not legal in this state.</summary>
    public static string? TryApply(string state, RunCommand command) => (state, command) switch
    {
        (RunStates.Running, RunCommand.Pause) => RunStates.Paused,
        (RunStates.Paused, RunCommand.Resume) => RunStates.Running,
        (RunStates.Running or RunStates.Paused, RunCommand.StopNow) => RunStates.Stopping,
        (RunStates.Held or RunStates.NeedsYou, RunCommand.StopNow) => RunStates.Stopped,
        (RunStates.Stopping, RunCommand.StopComplete) => RunStates.Stopped,
        (RunStates.Running, RunCommand.StopAfter) => RunStates.Running,
        (RunStates.Paused, RunCommand.StopAfter) => RunStates.Paused,
        (RunStates.Running, RunCommand.StepEndHeld) => RunStates.Held,
        (RunStates.Running, RunCommand.ReachBreakpoint) => RunStates.Held,
        (RunStates.Held, RunCommand.Resume) => RunStates.Running,
        (RunStates.Held or RunStates.Stopped, RunCommand.ResumeFrom) => RunStates.Running,
        (RunStates.Running, RunCommand.ReviewStep) => RunStates.NeedsYou,
        (RunStates.NeedsYou, RunCommand.Approve) => RunStates.Running,
        (RunStates.NeedsYou, RunCommand.ApproveLast) => RunStates.Done,
        (RunStates.NeedsYou, RunCommand.SendBack) => RunStates.Running,
        (RunStates.Running, RunCommand.FinishAll) => RunStates.Done,
        (RunStates.Stopped or RunStates.Held or RunStates.Done, RunCommand.Redo) => RunStates.Running,
        _ => null,
    };
}
