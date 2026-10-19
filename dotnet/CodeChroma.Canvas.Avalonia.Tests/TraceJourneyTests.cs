using System.Text.Json;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Layout;
using Avalonia.Threading;
using CodeChroma.Canvas.Hierarchy;
using CodeChroma.Canvas.Tracing;
using CodeChroma.Core;
using Avalonia.Input;

namespace CodeChroma.Canvas.Avalonia.Tests;

/// <summary>Headless replacement for trace-playback.spec.ts (both journeys): pick a recorded run, step, play, see the failure.</summary>
public class TraceJourneyTests
{
    private const string Billing = "dir::billing", Shared = "dir::shared";

    private sealed class ManualScheduler : ITraceScheduler
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

    private static List<Trace> Fixtures() =>
        JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "fixtures", "traces.json"))).RootElement
            .GetProperty("traces").EnumerateArray().Select(t => Trace.Parse(t.GetRawText())).ToList();

    private static (Window Window, HierarchyView View, TraceControls Controls, TracePlayer Player, ManualScheduler Clock) Open()
    {
        var core = new GraphCore();
        core.Analyze(AnalysisInputReader.Load(Path.Combine(AppContext.BaseDirectory, "fixtures", "sample_repo.input.json")));
        var source = new CoreHierarchySource(core.Snapshot);
        var expansion = new ExpansionState(source);
        var view = new HierarchyView(source, expansion, new CodeChroma.Canvas.State.TopLevelLayoutStore());
        var clock = new ManualScheduler();
        var player = new TracePlayer(clock);
        var traces = Fixtures();
        var controls = new TraceControls(player, traces.Select(t => new TraceSummary(t.Id, t.Entry, t.Status, t.Steps.Count)).ToList(),
            id => traces.FirstOrDefault(t => t.Id == id), id => source.Get(id)?.Name ?? id)
        { VerticalAlignment = VerticalAlignment.Bottom, HorizontalAlignment = HorizontalAlignment.Left, Background = global::Avalonia.Media.Brushes.White };
        view.Trace = player;
        var window = new Window { Width = 800, Height = 600, Content = new Grid { Children = { view, controls } } };
        window.Show();
        window.UpdateLayout();
        AvaloniaHeadlessPlatform.ForceRenderTimerTick();
        return (window, view, controls, player, clock);
    }

    private static void Press(Window window, Control button)
    {
        window.UpdateLayout();
        AvaloniaHeadlessPlatform.ForceRenderTimerTick();
        var p = button.TranslatePoint(new Point(button.Bounds.Width / 2, button.Bounds.Height / 2), window)!.Value;
        window.MouseDown(p, MouseButton.Left);
        window.MouseUp(p, MouseButton.Left);
        Dispatcher.UIThread.RunJobs();
    }

    [AvaloniaFact]
    public void Picking_a_trace_loads_it_at_step_one_and_frames_the_active_block_then_stepping_advances()
    {
        var (window, view, controls, _, _) = Open();

        controls.Picker.SelectedIndex = 1;
        var first = controls.StepCounter.Text;
        var firstMarks = view.TraceMarks;
        Press(window, controls.StepForwardButton);

        Assert.Equal("1/8", first);
        var active = Assert.Single(firstMarks.Nodes, n => n.Active);
        Assert.Equal(Billing, active.NodeId);
        Assert.False(active.Error);
        Assert.Equal("2/8", controls.StepCounter.Text);
        Assert.Equal("total . call", controls.CurrentNode.Text);
    }

    [AvaloniaFact]
    public void A_call_across_two_collapsed_systems_draws_an_edge_between_their_borders()
    {
        var (_, view, _, player, _) = Open();
        player.LoadTrace(Fixtures()[0]);

        player.ScrubTo(5);
        var edge = Assert.Single(view.TraceMarks.Edges, e => e.Active);

        Assert.Equal((Billing, Shared), (edge.CallerId, edge.CalleeId));
        var billing = view.RectOf(Billing);
        var shared = view.RectOf(Shared);
        Assert.Equal(billing.Right, edge.From.X, 6);
        Assert.Equal(shared.Left, edge.To.X, 6);
    }

    [AvaloniaFact]
    public void Expanding_the_blocks_makes_the_trace_resolve_to_the_function_blocks_themselves()
    {
        var (_, view, _, player, _) = Open();
        player.LoadTrace(Fixtures()[0]);
        var collapsed = view.TraceMarks.Nodes.Single(n => n.Active).NodeId;
        foreach (var id in new[] { Billing, "component::billing/service.py", "billing/service.py::class::BillingService" })
            view.Expansion.Expand(id);

        var expanded = view.TraceMarks.Nodes.Single(n => n.Active).NodeId;

        Assert.Equal(Billing, collapsed);
        Assert.Equal("billing/service.py::function::BillingService.create_invoice", expanded);
    }

    [AvaloniaFact]
    public void A_failed_trace_plays_to_its_culprit_and_shows_the_error_plaque_with_a_red_frame()
    {
        var (window, view, controls, player, clock) = Open();
        controls.Picker.SelectedIndex = 2;

        Press(window, controls.PlayButton);
        clock.Advance(60_000);

        Assert.False(player.IsPlaying);
        Assert.Equal("3/5", controls.StepCounter.Text);
        Assert.True(controls.ErrorPlaque.IsVisible);
        Assert.Contains("ValueError", controls.ErrorPlaque.Text);
        Assert.Contains("card declined", controls.ErrorPlaque.Text);
        Assert.True(view.TraceMarks.Nodes.Single(n => n.Active).Error);
    }

    [AvaloniaFact]
    public void The_call_stack_breakpoint_and_close_controls_work_together()
    {
        var (window, view, controls, player, clock) = Open();
        controls.Picker.SelectedIndex = 1;
        player.ScrubTo(2);
        var stack = controls.CallStack.Children.OfType<TextBlock>().Select(t => t.Text).ToArray();
        player.ScrubTo(0);

        Press(window, controls.BreakpointButton);
        player.TogglePlay();
        clock.Advance(60_000);
        var stoppedOnBreakpoint = player.StepIndex;
        Press(window, controls.CloseButton);

        Assert.Equal(new[] { "create_invoice", "total", "format_invoice_id" }, stack);
        Assert.Equal(7, stoppedOnBreakpoint);
        Assert.False(player.IsActive);
        Assert.Empty(view.TraceMarks.Nodes);
    }

    [AvaloniaFact]
    public void Follow_centres_the_active_block_on_each_step_and_unchecking_it_leaves_the_camera_alone()
    {
        var (_, view, controls, player, _) = Open();
        player.LoadTrace(Fixtures()[0]);
        player.ScrubTo(5);
        var header = view.TraceMarks.Nodes.Single(n => n.Active).Frame;
        var centre = view.Viewport.CanvasToScreen(new CodeChroma.Canvas.Geometry.Point(header.CenterX, header.CenterY));
        var camera = view.Viewport.State;

        controls.FollowToggle.IsChecked = false;
        player.ScrubTo(0);

        Assert.Equal(view.Viewport.Width / 2, centre.X, 0);
        Assert.Equal(camera, view.Viewport.State);
    }

    [AvaloniaFact]
    public void Live_mode_streams_steps_in_and_disables_stepping_until_the_run_ends()
    {
        var (_, view, controls, player, _) = Open();

        player.StartLive("live");
        player.AppendStep(Fixtures()[0].Steps[0]);
        player.AppendStep(Fixtures()[0].Steps[5]);
        var whileLive = (controls.StepForwardButton.IsEnabled, controls.PlayButton.IsEnabled, controls.StepCounter.Text);
        player.EndLive("ok");

        Assert.Equal((false, false, "2/2"), whileLive);
        Assert.True(controls.StepForwardButton.IsEnabled);
        Assert.Contains(view.TraceMarks.Edges, e => e.CalleeId == Shared);
    }

    [AvaloniaFact]
    public void Rendering_a_frame_with_trace_marks_does_not_throw()
    {
        var (window, view, _, player, _) = Open();
        player.LoadTrace(Fixtures()[1]);
        player.ScrubTo(2);

        var ex = Record.Exception(() => { window.UpdateLayout(); view.InvalidateVisual(); AvaloniaHeadlessPlatform.ForceRenderTimerTick(); });

        Assert.Null(ex);
    }
}
