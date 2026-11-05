using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;

namespace CodeChroma.Bridge.Tests.Agents;

/// <summary>The hook-to-status mapping, done/unread and the permission hand-off (bridge/agents/live_status.py).</summary>
public class AgentStatusStateTests
{
    private static readonly DateTimeOffset T0 = new(2026, 11, 5, 10, 0, 0, TimeSpan.Zero);

    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = T0;

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static (AgentStatusState State, Clock Clock) Make()
    {
        var clock = new Clock();
        return (new AgentStatusState(clock), clock);
    }

    private static JsonObject Hook(string name, string? tool = null, JsonObject? input = null, string? notification = null) => new()
    {
        ["hook_event_name"] = name, ["tool_name"] = tool, ["tool_input"] = input, ["notification_type"] = notification,
    };

    [Fact]
    public void A_prompt_starts_a_working_turn_with_no_tool_yet()
    {
        var (state, _) = Make();

        var outcome = state.ApplyHook(Hook("UserPromptSubmit"));

        var snapshot = state.Snapshot();
        Assert.True(outcome.Changed);
        Assert.Equal(("working", null, null, T0), (snapshot.Status, snapshot.Activity!.Tool, snapshot.Activity.Target, snapshot.Activity.TurnStartedAt));
    }

    [Fact]
    public void A_tool_call_names_the_tool_and_its_target_and_keeps_the_turn_start()
    {
        var (state, clock) = Make();
        state.ApplyHook(Hook("UserPromptSubmit"));
        clock.Now = T0.AddSeconds(30);

        state.ApplyHook(Hook("PreToolUse", "Edit", new JsonObject { ["file_path"] = "src/guard/policy.ts" }));

        var activity = state.Snapshot().Activity!;
        Assert.Equal(("Edit", "src/guard/policy.ts", T0), (activity.Tool, activity.Target, activity.TurnStartedAt));
    }

    [Theory]
    [InlineData("command", "npm run e2e")]
    [InlineData("pattern", "TODO")]
    [InlineData("url", "https://example.com")]
    public void The_target_falls_back_through_command_pattern_and_url(string key, string value)
    {
        var target = AgentStatusState.Target(new JsonObject { [key] = value });

        Assert.Equal(value, target);
    }

    [Fact]
    public void A_long_multi_line_command_is_one_line_of_at_most_120_chars()
    {
        var target = AgentStatusState.Target(new JsonObject { ["command"] = "echo a\n" + new string('x', 300) })!;

        Assert.Equal(120, target.Length);
        Assert.StartsWith("echo a xxx", target);
        Assert.EndsWith("…", target);
    }

    [Theory]
    [InlineData("permission_prompt", "blocked")]
    [InlineData("elicitation_dialog", "blocked")]
    [InlineData("idle_prompt", "working")]
    public void Only_permission_and_elicitation_notifications_block(string kind, string expected)
    {
        var (state, _) = Make();
        state.ApplyHook(Hook("UserPromptSubmit"));

        state.ApplyHook(Hook("Notification", notification: kind));

        Assert.Equal(expected, state.Snapshot().Status);
    }

    [Fact]
    public void Stop_is_done_until_seen_then_idle()
    {
        var (state, _) = Make();
        state.ApplyHook(Hook("UserPromptSubmit"));
        state.ApplyHook(Hook("Stop"));
        var done = state.Snapshot();

        var seen = state.MarkSeen();

        Assert.Equal(("done", null), (done.Status, done.Activity));
        Assert.True(seen);
        Assert.Equal("idle", state.Snapshot().Status);
    }

    [Fact]
    public async Task A_permission_request_blocks_and_hands_the_decision_to_the_waiting_hook()
    {
        var (state, _) = Make();
        var outcome = state.ApplyHook(Hook("PermissionRequest", "Bash", new JsonObject { ["command"] = "npm run e2e" }));
        var pending = state.Snapshot().Pending!;

        var accepted = state.Decide(outcome.RequestId!, "allow");

        Assert.Equal(("working", "Bash", "Bash(npm run e2e)"), (state.Snapshot().Status, pending.Tool, pending.Summary));
        Assert.Matches("^p_[0-9a-f]{6}$", pending.RequestId);
        Assert.True(accepted);
        Assert.Equal("allow", await outcome.Decision!);
        Assert.Null(state.Snapshot().Pending);
    }

    [Fact]
    public void An_unknown_request_id_is_not_decided()
    {
        var (state, _) = Make();
        state.ApplyHook(Hook("PermissionRequest", "Bash"));

        var accepted = state.Decide("p_000000", "allow");

        Assert.False(accepted);
        Assert.NotNull(state.Snapshot().Pending);
    }

    [Fact]
    public void A_parallel_tools_hooks_leave_another_tools_pending_request_waiting()
    {
        var (state, _) = Make();
        var outcome = state.ApplyHook(Hook("PermissionRequest", "Bash"));

        state.ApplyHook(Hook("PreToolUse", "Read"));
        state.ApplyHook(Hook("PostToolUse", "Read"));

        Assert.Equal(("blocked", outcome.RequestId), (state.Snapshot().Status, state.Snapshot().Pending?.RequestId));
        Assert.False(outcome.Decision!.IsCompleted);
    }

    [Fact]
    public void A_settled_visible_idle_prompt_ends_a_turn_that_never_sent_stop()
    {
        var (state, _) = Make();
        state.ApplyHook(Hook("PreToolUse", "Bash"));

        var changed = state.ApplyScreen("idle", visibleBlocker: false, visibleIdle: true);

        Assert.True(changed);
        Assert.Equal(("done", null), (state.Snapshot().Status, state.Snapshot().Activity));
    }

    [Fact]
    public void A_visible_idle_prompt_does_not_end_a_turn_while_a_canvas_request_waits()
    {
        var (state, _) = Make();
        state.ApplyHook(Hook("PermissionRequest", "Bash"));

        var changed = state.ApplyScreen("idle", visibleBlocker: false, visibleIdle: true);

        Assert.False(changed);
        Assert.Equal("blocked", state.Snapshot().Status);
    }

    [Fact]
    public void An_expired_request_leaves_the_agent_blocked_without_a_pending_request()
    {
        var (state, _) = Make();
        var outcome = state.ApplyHook(Hook("PermissionRequest", "Bash"));

        var expired = state.Expire(outcome.RequestId!);

        Assert.True(expired);
        Assert.Equal(("blocked", null), (state.Snapshot().Status, state.Snapshot().Pending));
    }

    [Fact]
    public void Before_any_hook_the_screen_decides_and_working_to_idle_is_done()
    {
        var (state, _) = Make();
        state.ApplyScreen("working", visibleBlocker: false);

        state.ApplyScreen("idle", visibleBlocker: false);

        Assert.Equal("done", state.Snapshot().Status);
    }

    [Fact]
    public void Once_hooks_report_the_screen_no_longer_sets_working_or_idle()
    {
        var (state, _) = Make();
        state.ApplyHook(Hook("UserPromptSubmit"));

        var changed = state.ApplyScreen("idle", visibleBlocker: false);

        Assert.False(changed);
        Assert.Equal("working", state.Snapshot().Status);
    }

    [Fact]
    public void Once_hooks_report_a_visible_blocker_still_blocks_and_its_disappearance_resumes_work()
    {
        var (state, _) = Make();
        state.ApplyHook(Hook("UserPromptSubmit"));
        state.ApplyScreen(null, visibleBlocker: true);
        var blocked = state.Snapshot().Status;

        state.ApplyScreen(null, visibleBlocker: false);

        Assert.Equal(("blocked", "working"), (blocked, state.Snapshot().Status));
    }

    [Fact]
    public void Status_since_moves_only_when_the_status_changes()
    {
        var (state, clock) = Make();
        state.ApplyHook(Hook("UserPromptSubmit"));
        clock.Now = T0.AddMinutes(1);
        state.ApplyHook(Hook("PreToolUse", "Read"));
        var unchanged = state.Snapshot().Since;
        clock.Now = T0.AddMinutes(2);

        state.ApplyHook(Hook("Stop"));

        Assert.Equal((T0, T0.AddMinutes(2)), (unchanged, state.Snapshot().Since));
    }

    [Fact]
    public void An_unknown_event_changes_nothing_and_does_not_take_over_from_the_screen()
    {
        var (state, _) = Make();

        var outcome = state.ApplyHook(Hook("SessionStart"));

        Assert.False(outcome.Changed);
        Assert.False(state.Hooked);
    }
}
