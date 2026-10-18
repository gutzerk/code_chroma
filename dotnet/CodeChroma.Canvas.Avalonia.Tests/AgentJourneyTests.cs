using Avalonia;
using Avalonia.Controls;
using Avalonia.Headless;
using Avalonia.Headless.XUnit;
using Avalonia.Input;
using Avalonia.Threading;
using CodeChroma.Canvas.Agents;
using CodeChroma.Canvas.Hierarchy;
using CodeChroma.Canvas.State;

namespace CodeChroma.Canvas.Avalonia.Tests;

/// <summary>
/// Headless replacements for agent-windows.spec.ts (15 journeys). The terminal inside a window is the shell's xterm WebView and
/// is represented here by a placeholder control, so each test pins the window layer's behaviour only, as the Playwright specs did
/// against MockAgentClient.
/// </summary>
public class AgentJourneyTests
{
    private sealed class FakeClient : IAgentClient
    {
        private int _n;
        public Func<string, string?>? BaseBranchFor { get; set; }
        public List<string> Deleted { get; } = new();

        public Task<AgentRecord> CreateAsync(string activeWorkspace)
        {
            var id = $"agent{++_n}";
            return Task.FromResult(new AgentRecord(id, id, "idle", new WindowGeometry(120 + _n * 30, 100, 520, 340, false, _n), "b", BaseBranchFor?.Invoke(id), null, activeWorkspace));
        }

        public Task DeleteAsync(string id) { Deleted.Add(id); return Task.CompletedTask; }
        public Task SaveWindowAsync(string id, WindowGeometry geometry) => Task.CompletedTask;
        public Task ActivateWorkspaceAsync(string id) => Task.CompletedTask;
    }

    private sealed class Tiny : IHierarchySource
    {
        private readonly HierarchyItem _a = new("a", "alpha", "system", HierarchyIds.Root, false, "d");
        public HierarchyItem? Get(string id) => id == "a" ? _a : null;
        public IReadOnlyList<HierarchyItem> Children(string id) => id == HierarchyIds.Root ? [_a] : [];
    }

    private static (Window Window, AgentWorkspaceView View, AgentWindowStore Store, FakeClient Client, Dictionary<string, int> Mounts, HierarchyView Canvas) Open()
    {
        var client = new FakeClient();
        var store = new AgentWindowStore(client, 1400, 900);
        var mounts = new Dictionary<string, int>();
        var canvas = new HierarchyCanvas(new Tiny());
        var view = new AgentWorkspaceView(store, a =>
        {
            mounts[a.Id] = mounts.GetValueOrDefault(a.Id) + 1;
            return new TextBlock { Text = $"terminal {a.Id}" };
        });
        var window = new Window { Width = 1400, Height = 900, Content = new Grid { Children = { canvas, view } } };
        window.Show();
        Layout(window);
        return (window, view, store, client, mounts, canvas.View);
    }

    private static void Layout(Window window)
    {
        window.UpdateLayout();
        AvaloniaHeadlessPlatform.ForceRenderTimerTick();
    }

    private static Point CenterOf(Window window, Control c) => c.TranslatePoint(new Point(c.Bounds.Width / 2, c.Bounds.Height / 2), window)!.Value;

    private static void Press(Window window, Control target)
    {
        Layout(window);
        var p = CenterOf(window, target);
        window.MouseDown(p, MouseButton.Left);
        window.MouseUp(p, MouseButton.Left);
        for (var i = 0; i < 5; i++) Dispatcher.UIThread.RunJobs();
        Layout(window);
    }

    [AvaloniaFact]
    public void Run_agent_opens_a_running_window_immediately_and_a_second_click_opens_an_independent_one()
    {
        var (window, view, store, _, _, _) = Open();

        Press(window, view.RunButton);
        Press(window, view.RunButton);

        Assert.True(view.WindowOf("agent1")!.IsVisible);
        Assert.True(view.WindowOf("agent2")!.IsVisible);
        Assert.Equal("terminal agent1", ((TextBlock)view.WindowOf("agent1")!.Content).Text);
        Assert.Equal(2, store.Agents.Count);
    }

    [AvaloniaFact]
    public void The_window_drags_by_its_title_bar_and_minimizes_and_restores_from_the_rail()
    {
        var (window, view, _, _, _, _) = Open();
        Press(window, view.RunButton);
        var agent = view.WindowOf("agent1")!;
        var before = agent.TranslatePoint(new Point(0, 0), window)!.Value;
        var grip = agent.TitleBar.TranslatePoint(new Point(120, 16), window)!.Value;

        window.MouseDown(grip, MouseButton.Left);
        window.MouseMove(new Point(grip.X + 100, grip.Y + 60));
        window.MouseMove(new Point(grip.X + 220, grip.Y + 140));
        window.MouseUp(new Point(grip.X + 220, grip.Y + 140), MouseButton.Left);
        Layout(window);
        var after = agent.TranslatePoint(new Point(0, 0), window)!.Value;
        Press(window, agent.MinimizeButton);
        var hidden = !agent.IsVisible;
        Press(window, view.RailItem("agent1")!);

        Assert.InRange(after.X - before.X, 219, 221);
        Assert.InRange(after.Y - before.Y, 139, 141);
        Assert.True(hidden);
        Assert.True(agent.IsVisible);
    }

    [AvaloniaFact]
    public void The_rail_keeps_an_entry_per_agent_and_toggles_its_window_from_there()
    {
        var (window, view, store, _, _, _) = Open();
        Press(window, view.RunButton);
        var pressedAtStart = store.Rail.Single().Pressed;

        Press(window, view.RailItem("agent1")!);
        var afterFirst = (store.Rail.Single().Pressed, view.WindowOf("agent1")!.IsVisible, view.RailItem("agent1") is not null);
        Press(window, view.RailItem("agent1")!);

        Assert.True(pressedAtStart);
        Assert.Equal((false, false, true), afterFirst);
        Assert.True(store.Rail.Single().Pressed);
        Assert.True(view.WindowOf("agent1")!.IsVisible);
    }

    [AvaloniaFact]
    public void A_minimized_windows_rail_entry_shows_the_task_title_and_status_as_text()
    {
        var (window, view, _, _, _, _) = Open();
        Press(window, view.RunButton);
        Press(window, view.WindowOf("agent1")!.MinimizeButton);

        var texts = ((StackPanel)((StackPanel)view.RailItem("agent1")!.Content!).Children[1]).Children.OfType<TextBlock>().Select(t => t.Text).ToArray();

        Assert.Equal(new[] { "agent1", "Idle" }, texts);
    }

    [AvaloniaFact]
    public void Minimizing_keeps_the_terminal_mounted_so_restoring_is_not_a_reattach()
    {
        var (window, view, _, _, mounts, _) = Open();
        Press(window, view.RunButton);
        var terminal = view.WindowOf("agent1")!.Content;

        Press(window, view.WindowOf("agent1")!.MinimizeButton);
        Press(window, view.RailItem("agent1")!);

        Assert.Same(terminal, view.WindowOf("agent1")!.Content);
        Assert.Equal(1, mounts["agent1"]);
        Assert.NotNull(terminal.Parent);
    }

    [AvaloniaFact]
    public void Closing_takes_the_window_and_its_rail_entry_away_with_no_confirmation()
    {
        var (window, view, _, client, _, _) = Open();
        Press(window, view.RunButton);

        Press(window, view.WindowOf("agent1")!.CloseButton);

        Assert.Null(view.WindowOf("agent1"));
        Assert.Null(view.RailItem("agent1"));
        Assert.Equal(new[] { "agent1" }, client.Deleted);
    }

    [AvaloniaFact]
    public void The_sixth_agent_is_refused_Run_agent_goes_disabled_and_its_tooltip_gives_the_limit()
    {
        var (window, view, store, _, _, _) = Open();
        for (var i = 0; i < 5; i++) Press(window, view.RunButton);

        Assert.False(view.RunButton.IsEnabled);
        Assert.Equal("5 agents is the limit — close one to start another", ToolTip.GetTip(view.RunButton));
        Assert.Equal(5, store.Agents.Count);
    }

    [AvaloniaFact]
    public void An_agent_window_stays_put_under_canvas_zoom_since_it_lives_in_screen_coordinates()
    {
        var (window, view, _, _, _, canvas) = Open();
        Press(window, view.RunButton);
        var agent = view.WindowOf("agent1")!;
        var before = (agent.TranslatePoint(new Point(0, 0), window)!.Value, agent.Bounds.Width);

        window.MouseWheel(new Point(1000, 700), new Vector(0, 3));
        Layout(window);

        Assert.True(canvas.Viewport.State.Scale > 1);
        Assert.Equal(before.Item1, agent.TranslatePoint(new Point(0, 0), window)!.Value);
        Assert.Equal(before.Item2, agent.Bounds.Width);
    }

    [AvaloniaFact]
    public void The_rail_led_reflects_the_launched_agents_status_and_launching_leaves_the_canvas_workspace_unchanged()
    {
        var (window, view, store, _, _, _) = Open();

        Press(window, view.RunButton);
        Press(window, view.WindowOf("agent1")!.MinimizeButton);

        Assert.Equal("idle", store.Rail.Single().Status);
        Assert.Equal("main", view.ActiveWorkspace);
        var led = ((StackPanel)view.RailItem("agent1")!.Content!).Children.OfType<Border>().Single();
        Assert.Equal(AgentWindow.Led("idle").Background, led.Background);
    }

    [AvaloniaFact]
    public void Switching_main_s_branch_keeps_the_window_and_terminal_and_dims_the_rail_entry_with_an_on_branch_label()
    {
        var (window, view, store, client, mounts, _) = Open();
        client.BaseBranchFor = _ => "main";
        Press(window, view.RunButton);

        store.SetBranch("feature-x");
        Layout(window);

        Assert.True(view.WindowOf("agent1")!.IsVisible);
        Assert.Equal(1, mounts["agent1"]);
        Assert.True(view.RailItem("agent1")!.Opacity < 1);
        var status = ((StackPanel)((StackPanel)view.RailItem("agent1")!.Content!).Children[1]).Children.OfType<TextBlock>().Last().Text;
        Assert.Equal("on main", status);
        Press(window, view.RailItem("agent1")!);
        Assert.False(view.WindowOf("agent1")!.IsVisible);
        Press(window, view.RailItem("agent1")!);
        Assert.True(view.WindowOf("agent1")!.IsVisible);
        Assert.Equal("main", view.ActiveWorkspace);
    }

    [AvaloniaFact]
    public void Resizing_the_host_re_clamps_windows_so_a_title_bar_is_never_stranded_off_screen()
    {
        var (window, view, store, _, _, _) = Open();
        Press(window, view.RunButton);
        store.Move("agent1", 900, 500);

        view.HorizontalAlignment = global::Avalonia.Layout.HorizontalAlignment.Left;
        view.VerticalAlignment = global::Avalonia.Layout.VerticalAlignment.Top;
        view.Width = 700;
        view.Height = 500;
        Layout(window);

        var w = store.Get("agent1")!.Window;
        Assert.True(w.X <= 700 - AgentWindowStore.MinVisible);
        Assert.True(w.Y <= 500 - AgentWindowStore.MinVisible);
    }
}
