using CodeChroma.Canvas.Agents;

namespace CodeChroma.Canvas.Tests.Agents;

internal sealed class FakeAgentClient : IAgentClient
{
    private int _counter;
    public List<string> Created { get; } = new();
    public List<string> Deleted { get; } = new();
    public List<(string Id, WindowGeometry Geometry)> Saved { get; } = new();
    public List<string> Activated { get; } = new();
    public bool FailDelete { get; set; }
    public TaskCompletionSource<bool>? Gate { get; set; }
    public Func<string, string?>? BaseBranchFor { get; set; }

    public async Task<AgentRecord> CreateAsync(string activeWorkspace)
    {
        if (Gate is not null) await Gate.Task;
        var id = $"agent{++_counter}";
        Created.Add(id);
        return new AgentRecord(id, id, "idle", new WindowGeometry(100 + _counter * 20, 80, 640, 420, false, _counter), "branch", BaseBranchFor?.Invoke(id));
    }

    public Task DeleteAsync(string id)
    {
        if (FailDelete) throw new InvalidOperationException("delete failed");
        Deleted.Add(id);
        return Task.CompletedTask;
    }

    public Task SaveWindowAsync(string id, WindowGeometry geometry)
    {
        Saved.Add((id, geometry));
        return Task.CompletedTask;
    }

    public Task ActivateWorkspaceAsync(string id)
    {
        Activated.Add(id);
        return Task.CompletedTask;
    }
}

public class AgentWindowStoreTests
{
    private static (AgentWindowStore Store, FakeAgentClient Client) Make(double w = 1280, double h = 800)
    {
        var client = new FakeAgentClient();
        return (new AgentWindowStore(client, w, h), client);
    }

    [Fact]
    public async Task Run_agent_opens_a_running_window_at_once_and_a_second_click_opens_an_independent_one()
    {
        var (store, _) = Make();

        var first = await store.LaunchAsync();
        var second = await store.LaunchAsync();

        Assert.Equal(new[] { "agent1", "agent2" }, store.VisibleWindows.Select(a => a.Id));
        Assert.NotEqual(first!.Id, second!.Id);
        Assert.Equal("main", store.ActiveWorkspace);
    }

    [Fact]
    public async Task The_sixth_agent_is_refused_and_Run_agent_explains_the_limit()
    {
        var (store, client) = Make();
        for (var i = 0; i < 5; i++) await store.LaunchAsync();

        var sixth = await store.LaunchAsync();

        Assert.Null(sixth);
        Assert.False(store.CanRun);
        Assert.Equal("5 agents is the limit — close one to start another", store.RunDisabledReason);
        Assert.Equal(5, client.Created.Count);
    }

    [Fact]
    public async Task A_double_click_during_a_launch_cannot_slip_past_the_guard()
    {
        var (store, client) = Make();
        client.Gate = new TaskCompletionSource<bool>();

        var first = store.LaunchAsync();
        var second = await store.LaunchAsync();
        client.Gate.SetResult(true);
        await first;

        Assert.Null(second);
        Assert.Single(client.Created);
        Assert.False(store.IsLaunching);
    }

    [Fact]
    public async Task Closing_removes_the_window_without_a_confirmation_and_frees_a_slot()
    {
        var (store, client) = Make();
        for (var i = 0; i < 5; i++) await store.LaunchAsync();

        await store.CloseAsync("agent1");

        Assert.Null(store.Get("agent1"));
        Assert.Equal(new[] { "agent1" }, client.Deleted);
        Assert.True(store.CanRun);
    }

    [Fact]
    public async Task Dragging_moves_the_window_in_screen_pixels_and_commits_only_on_release()
    {
        var (store, client) = Make();
        await store.LaunchAsync();
        var before = store.Get("agent1")!.Window;

        store.Move("agent1", 220, 140);
        store.Move("agent1", 5, 5);
        var during = client.Saved.Count;
        await store.CommitWindowAsync("agent1");

        Assert.Equal(before.X + 225, store.Get("agent1")!.Window.X);
        Assert.Equal(before.Y + 145, store.Get("agent1")!.Window.Y);
        Assert.Equal(0, during);
        Assert.Single(client.Saved);
    }

    [Theory]
    [InlineData(-500, -500, 0, 0)]
    [InlineData(5000, 5000, 1160, 680)]
    public async Task A_window_dragged_off_screen_keeps_its_title_bar_reachable(double dx, double dy, double x, double y)
    {
        var (store, _) = Make();
        await store.LaunchAsync();
        store.Move("agent1", -store.Get("agent1")!.Window.X, -store.Get("agent1")!.Window.Y);

        store.Move("agent1", dx, dy);

        Assert.Equal(x, store.Get("agent1")!.Window.X);
        Assert.Equal(y, store.Get("agent1")!.Window.Y);
    }

    [Fact]
    public async Task Shrinking_the_viewport_re_clamps_windows_that_ended_up_beyond_it()
    {
        var (store, _) = Make();
        await store.LaunchAsync();
        store.Move("agent1", 600, 300);

        store.SetViewport(500, 400);

        var w = store.Get("agent1")!.Window;
        Assert.True(w.X <= 500 - AgentWindowStore.MinVisible);
        Assert.True(w.Y <= 400 - AgentWindowStore.MinVisible);
        Assert.True(w.Width <= 500);
    }

    [Fact]
    public async Task Minimize_hides_the_window_but_the_rail_entry_stays_and_restoring_raises_it_to_the_front()
    {
        var (store, client) = Make();
        await store.LaunchAsync();
        await store.LaunchAsync();

        await store.ToggleFromRailAsync("agent1");
        var hidden = store.VisibleWindows.Select(a => a.Id).ToArray();
        var entry = store.Rail.Single(r => r.Id == "agent1");
        await store.ToggleFromRailAsync("agent1");

        Assert.Equal(new[] { "agent2" }, hidden);
        Assert.False(entry.Pressed);
        Assert.Equal("agent1", entry.Title);
        Assert.Equal("Idle", entry.StatusText);
        Assert.True(store.Rail.Single(r => r.Id == "agent1").Pressed);
        Assert.True(store.Get("agent1")!.Window.Z > store.Get("agent2")!.Window.Z);
        Assert.Equal(2, client.Saved.Count);
    }

    [Fact]
    public async Task Restoring_an_agent_follows_its_workspace_once_and_does_not_re_activate_one_it_is_already_on()
    {
        var (store, client) = Make();
        await store.LaunchAsync();
        await store.MinimizeAsync("agent1");

        await store.RestoreAsync("agent1");
        await store.MinimizeAsync("agent1");
        await store.RestoreAsync("agent1");

        Assert.Equal("agent1", store.ActiveWorkspace);
        Assert.Equal(new[] { "agent1" }, client.Activated);
    }

    [Fact]
    public async Task Minimizing_never_changes_the_active_workspace()
    {
        var (store, client) = Make();
        await store.LaunchAsync();

        await store.MinimizeAsync("agent1");

        Assert.Equal("main", store.ActiveWorkspace);
        Assert.Empty(client.Activated);
    }

    [Fact]
    public async Task Closing_the_active_workspace_s_agent_falls_back_to_main()
    {
        var (store, _) = Make();
        await store.LaunchAsync();
        await store.MinimizeAsync("agent1");
        await store.RestoreAsync("agent1");

        await store.CloseAsync("agent1");

        Assert.Equal("main", store.ActiveWorkspace);
    }

    [Fact]
    public async Task Switching_main_s_branch_dims_an_agent_from_another_branch_labels_it_and_keeps_its_window()
    {
        var (store, client) = Make();
        client.BaseBranchFor = _ => "main";
        await store.LaunchAsync();

        store.SetBranch("feature-x");

        var entry = store.Rail.Single();
        Assert.True(entry.OffBranch);
        Assert.Equal("on main", entry.StatusText);
        Assert.Single(store.VisibleWindows);
        Assert.Equal("main", store.ActiveWorkspace);
    }

    [Theory]
    [InlineData(null, "feature-x", true)]
    [InlineData("main", null, true)]
    [InlineData("main", "main", true)]
    [InlineData("main", "feature-x", false)]
    public async Task An_agent_is_in_branch_scope_unless_both_branches_are_known_and_differ(string? baseBranch, string? current, bool inScope)
    {
        var (store, client) = Make();
        client.BaseBranchFor = _ => baseBranch;
        await store.LaunchAsync();

        store.SetBranch(current);

        Assert.Equal(inScope, store.IsOnBranch(store.Get("agent1")!));
    }

    [Theory]
    [InlineData("idle", "Idle")]
    [InlineData("exited", "Crashed")]
    [InlineData("foreign", "Running something else")]
    [InlineData("mystery", "mystery")]
    public void Status_words_are_spelled_out_so_the_LED_colour_is_never_the_only_signal(string status, string label)
    {
        Assert.Equal(label, AgentStatusLabels.Of(status));
    }

    [Fact]
    public async Task A_failed_close_request_surfaces_the_error_but_the_window_is_already_gone()
    {
        var (store, client) = Make();
        await store.LaunchAsync();
        client.FailDelete = true;

        await store.CloseAsync("agent1");

        Assert.Null(store.Get("agent1"));
        Assert.Equal("delete failed", store.LaunchError);
    }
}
