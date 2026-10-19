using CodeChroma.Canvas.Tracing;

namespace CodeChroma.Canvas.Tests.Tracing;

/// <summary>A clock the test advances by hand: the player's timer without real waiting.</summary>
internal sealed class ManualScheduler : ITraceScheduler
{
    private sealed class Task(double due, Action run) : IDisposable
    {
        public double Due { get; } = due;
        public Action Run { get; } = run;
        public bool Done { get; set; }
        public void Dispose() => Done = true;
    }

    private readonly List<Task> _tasks = new();
    private double _now;

    public IDisposable After(TimeSpan delay, Action action)
    {
        var task = new Task(_now + delay.TotalMilliseconds, action);
        _tasks.Add(task);
        return task;
    }

    public void Advance(double ms)
    {
        var target = _now + ms;
        while (_tasks.Where(t => !t.Done && t.Due <= target).OrderBy(t => t.Due).FirstOrDefault() is { } next)
        {
            _now = next.Due;
            next.Done = true;
            next.Run();
        }
        _now = target;
    }
}

public class TracePlayerTests
{
    private static Trace Fixture(string id)
    {
        var raw = Fx.Load("traces.json").GetProperty("traces").EnumerateArray().Single(t => t.GetProperty("id").GetString() == id);
        return Trace.Parse(raw.GetRawText());
    }

    private static TraceFrame Frame(int seq, string node, string ev) => new() { Seq = seq, NodeId = node, Event = ev };

    private static (TracePlayer Player, ManualScheduler Clock) Make()
    {
        var clock = new ManualScheduler();
        return (new TracePlayer(clock), clock);
    }

    [Fact]
    public void Loading_a_trace_activates_playback_at_the_first_step()
    {
        var (player, _) = Make();

        player.LoadTrace(Fixture("checkout-ok"));

        Assert.True(player.IsActive);
        Assert.Equal(0, player.StepIndex);
        Assert.Equal(8, player.Steps.Count);
        Assert.Equal("billing/service.py::function::BillingService.create_invoice", player.CurrentFrame!.NodeId);
    }

    [Fact]
    public void Stepping_clamps_to_the_trace_bounds()
    {
        var (player, _) = Make();
        player.LoadTrace(Fixture("checkout-ok"));

        player.StepBack();
        var atStart = player.StepIndex;
        for (var i = 0; i < 20; i++) player.StepForward();

        Assert.Equal(0, atStart);
        Assert.Equal(7, player.StepIndex);
    }

    [Fact]
    public void Play_advances_on_the_timer_scaled_by_speed_and_pauses_at_the_end()
    {
        var (player, clock) = Make();
        player.LoadTrace(Fixture("checkout-ok"));
        player.SetSpeed(2);

        player.Play();
        clock.Advance(TracePlayer.BaseStepMs / 2 * 3);
        var afterThree = player.StepIndex;
        clock.Advance(60_000);

        Assert.Equal(3, afterThree);
        Assert.False(player.IsPlaying);
        Assert.Equal(7, player.StepIndex);
    }

    [Fact]
    public void Play_pauses_on_a_breakpoint_node()
    {
        var (player, clock) = Make();
        player.LoadTrace(Fixture("checkout-ok"));
        player.ToggleBreakpoint("billing/models/invoice.py::function::format_invoice_id");

        player.Play();
        clock.Advance(60_000);

        Assert.False(player.IsPlaying);
        Assert.Equal(2, player.StepIndex);
    }

    [Fact]
    public void Play_on_a_failed_trace_stops_on_the_culprit_raise_frame()
    {
        var (player, clock) = Make();
        player.LoadTrace(Fixture("checkout-declined"));

        player.Play();
        clock.Advance(60_000);

        Assert.False(player.IsPlaying);
        Assert.Equal(2, player.StepIndex);
        Assert.Equal("raise", player.CurrentFrame!.Event);
        Assert.Equal("card declined", player.CurrentFrame.Error!.Message);
    }

    [Fact]
    public void Pausing_cancels_the_pending_tick_and_play_from_the_end_restarts()
    {
        var (player, clock) = Make();
        player.LoadTrace(Fixture("checkout-ok"));
        player.Play();
        clock.Advance(TracePlayer.BaseStepMs);
        player.Pause();

        clock.Advance(60_000);
        var frozen = player.StepIndex;
        player.ScrubTo(7);
        player.Play();

        Assert.Equal(1, frozen);
        Assert.Equal(0, player.StepIndex);
        Assert.True(player.IsPlaying);
    }

    [Fact]
    public void Live_mode_appends_streamed_steps_and_refuses_scrubbing_until_the_run_ends()
    {
        var (player, _) = Make();
        player.StartLive("live1");
        player.AppendStep(Frame(0, "a", "call"));
        player.AppendStep(Frame(1, "b", "call"));

        player.ScrubTo(0);
        var whileLive = player.StepIndex;
        player.Play();
        var playedWhileLive = player.IsPlaying;
        player.EndLive("ok");
        player.ScrubTo(0);

        Assert.Equal(1, whileLive);
        Assert.False(playedWhileLive);
        Assert.False(player.IsLive);
        Assert.Equal(0, player.StepIndex);
    }

    [Fact]
    public void EnsureLive_starts_a_run_once_so_early_steps_are_not_dropped()
    {
        var (player, _) = Make();

        player.EnsureLive("reconnect");
        player.AppendStep(Frame(0, "a", "call"));
        player.EnsureLive("reconnect");

        Assert.True(player.IsLive);
        Assert.Single(player.Steps);
    }

    [Fact]
    public void An_unhandled_streamed_error_marks_the_run_failed()
    {
        var (player, _) = Make();
        player.StartLive("live1");

        player.AppendStep(new TraceFrame { NodeId = "a", Event = "raise", Error = new TraceError("ValueError", "x", false) });

        Assert.Equal("failed", player.Trace!.Status);
    }

    [Fact]
    public void A_malformed_trace_without_a_steps_list_loads_as_empty()
    {
        var (player, _) = Make();

        player.LoadTrace(Trace.Parse("{\"id\":\"bad\",\"steps\":null}"));

        Assert.Empty(player.Steps);
        Assert.Null(player.CurrentFrame);
    }

    [Fact]
    public void The_call_stack_is_rebuilt_by_replaying_calls_returns_and_unwinds()
    {
        var steps = Fixture("checkout-ok").Steps;

        var atFormat = TracePlayer.CallStackAt(steps, 2).Select(e => e.NodeId.Split("::").Last()).ToArray();
        var afterReturns = TracePlayer.CallStackAt(steps, 4).Select(e => e.NodeId.Split("::").Last()).ToArray();
        var end = TracePlayer.CallStackAt(steps, 7);

        Assert.Equal(new[] { "BillingService.create_invoice", "Invoice.total", "format_invoice_id" }, atFormat);
        Assert.Equal(new[] { "BillingService.create_invoice" }, afterReturns);
        Assert.Empty(end);
    }

    [Fact]
    public void Reset_clears_breakpoints_speed_and_follow()
    {
        var (player, _) = Make();
        player.LoadTrace(Fixture("checkout-ok"));
        player.ToggleBreakpoint("x");
        player.SetSpeed(4);
        player.SetFollowCamera(false);

        player.Reset();

        Assert.Empty(player.Breakpoints);
        Assert.Equal(1, player.Speed);
        Assert.True(player.FollowCamera);
        Assert.False(player.IsActive);
    }
}

public class TraceFlowTests
{
    private static readonly Rect Caller = new(100, 100, 200, 40);
    private static readonly Rect Callee = new(500, 100, 200, 40);

    private static Trace TwoStep(string secondEvent = "call", TraceError? error = null) => new()
    {
        Id = "t",
        Steps =
        {
            new TraceFrame { NodeId = "caller", Event = "call" },
            new TraceFrame { NodeId = "callee", Event = secondEvent, CallerNodeId = "caller", Error = error },
        },
    };

    private static Rect? Headers(string id) => id switch { "caller" => Caller, "callee" => Callee, _ => null };

    [Fact]
    public void The_active_step_draws_a_border_to_border_edge_and_frames_the_callee_with_padding()
    {
        var (nodes, edges) = TraceFlow.Compute(TwoStep(), 1, id => id, Headers);

        var edge = Assert.Single(edges);
        Assert.Equal(new Point(300, 120), edge.From);
        Assert.Equal(new Point(500, 120), edge.To);
        Assert.True(edge.Active);
        var active = Assert.Single(nodes, n => n.Active);
        Assert.Equal(new Rect(496, 96, 208, 48), active.Frame);
        Assert.Equal(2, nodes.Count);
    }

    [Fact]
    public void An_error_frame_marks_its_node_and_edge_as_errors()
    {
        var (nodes, edges) = TraceFlow.Compute(TwoStep("raise", new TraceError("ValueError", "declined", false)), 1, id => id, Headers);

        Assert.True(Assert.Single(edges).Error);
        Assert.True(nodes.Single(n => n.Active).Error);
        Assert.False(nodes.Single(n => !n.Active).Error);
    }

    [Fact]
    public void Endpoints_snap_to_the_nearest_visible_block_and_a_self_edge_is_not_drawn()
    {
        var (nodes, edges) = TraceFlow.Compute(TwoStep(), 1, _ => "callee", Headers);

        Assert.Empty(edges);
        Assert.Equal(2, nodes.Count);
        Assert.All(nodes, n => Assert.Equal(new Rect(496, 96, 208, 48), n.Frame));
    }

    [Fact]
    public void Nothing_draws_without_a_trace_or_for_a_node_with_no_block()
    {
        var none = TraceFlow.Compute(null, 0, id => id, Headers);
        var unknown = TraceFlow.Compute(TwoStep(), 1, _ => "ghost", Headers);

        Assert.Empty(none.Nodes);
        Assert.Empty(unknown.Nodes);
        Assert.Empty(unknown.Edges);
    }

    [Fact]
    public void Only_the_last_five_steps_trail_behind_the_current_one()
    {
        var trace = new Trace { Id = "t" };
        for (var i = 0; i < 12; i++) trace.Steps.Add(new TraceFrame { NodeId = i % 2 == 0 ? "caller" : "callee", Event = "call" });

        var (nodes, _) = TraceFlow.Compute(trace, 11, id => id, Headers);

        Assert.Equal(3, nodes.Count);
        Assert.Single(nodes, n => n.Active);
        Assert.Equal(new[] { "caller", "callee", "callee" }, nodes.Select(n => n.NodeId));
    }
}
