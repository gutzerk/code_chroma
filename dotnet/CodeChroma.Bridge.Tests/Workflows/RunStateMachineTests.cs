using CodeChroma.Bridge.Workflows;

namespace CodeChroma.Bridge.Tests.Workflows;

public sealed class RunStateMachineTests
{
    [Theory]
    [InlineData("running", RunCommand.Pause, "paused")]
    [InlineData("paused", RunCommand.Resume, "running")]
    [InlineData("running", RunCommand.StopNow, "stopping")]
    [InlineData("stopping", RunCommand.StopComplete, "stopped")]
    [InlineData("running", RunCommand.StopAfter, "running")]
    [InlineData("running", RunCommand.StepEndHeld, "held")]
    [InlineData("held", RunCommand.Resume, "running")]
    [InlineData("held", RunCommand.ResumeFrom, "running")]
    [InlineData("running", RunCommand.ReachBreakpoint, "held")]
    [InlineData("running", RunCommand.ReviewStep, "needs_you")]
    [InlineData("needs_you", RunCommand.Approve, "running")]
    [InlineData("needs_you", RunCommand.ApproveLast, "done")]
    [InlineData("needs_you", RunCommand.SendBack, "running")]
    [InlineData("running", RunCommand.FinishAll, "done")]
    [InlineData("stopped", RunCommand.ResumeFrom, "running")]
    [InlineData("paused", RunCommand.StopNow, "stopping")]
    [InlineData("held", RunCommand.StopNow, "stopped")]
    [InlineData("stopped", RunCommand.Redo, "running")]
    [InlineData("held", RunCommand.Redo, "running")]
    [InlineData("done", RunCommand.Redo, "running")]
    public void A_legal_command_moves_to_the_table_state(string state, RunCommand command, string expected)
    {
        var next = RunStateMachine.Apply(state, command);

        Assert.Equal(expected, next);
        Assert.True(RunStateMachine.IsLegal(state, command));
    }

    [Theory]
    [InlineData("done", RunCommand.Pause)]
    [InlineData("done", RunCommand.ResumeFrom)]
    [InlineData("stopped", RunCommand.Resume)]
    [InlineData("stopping", RunCommand.Pause)]
    [InlineData("paused", RunCommand.ReachBreakpoint)]
    [InlineData("held", RunCommand.Pause)]
    [InlineData("needs_you", RunCommand.Resume)]
    [InlineData("running", RunCommand.Approve)]
    [InlineData("running", RunCommand.StopComplete)]
    [InlineData("running", RunCommand.Redo)]
    [InlineData("paused", RunCommand.Redo)]
    [InlineData("needs_you", RunCommand.Redo)]
    public void An_illegal_command_leaves_the_state_unchanged(string state, RunCommand command)
    {
        var next = RunStateMachine.Apply(state, command);

        Assert.Equal(state, next);
        Assert.False(RunStateMachine.IsLegal(state, command));
    }

    [Fact]
    public void Every_state_string_matches_the_wire_contract()
    {
        var states = new[] { RunStates.Running, RunStates.Paused, RunStates.Stopping, RunStates.Held, RunStates.Stopped, RunStates.NeedsYou, RunStates.Done };

        Assert.Equal(["running", "paused", "stopping", "held", "stopped", "needs_you", "done"], states);
    }
}
