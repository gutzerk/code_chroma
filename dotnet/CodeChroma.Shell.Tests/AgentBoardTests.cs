using System.Text.Json;
using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests;

public class AgentRollupTests
{
    private static AgentEntry Agent(string id, string status, string? worktree = null) =>
        new(id, id, status, worktree, worktree, null, null, DateTimeOffset.Parse("2026-11-05T10:00:00Z"));

    private static AgentSummary Summary(params AgentEntry[] agents) => new(agents);

    [Theory]
    [InlineData(new[] { "idle", "working", "done", "error", "blocked" }, "blocked")]
    [InlineData(new[] { "working", "done", "error" }, "error")]
    [InlineData(new[] { "working", "done" }, "done")]
    [InlineData(new[] { "idle", "working" }, "working")]
    [InlineData(new[] { "idle", "stopped" }, null)]
    public void The_top_status_follows_blocked_error_done_working(string[] statuses, string? top)
    {
        var agents = statuses.Select((s, i) => Agent($"a{i}", s));

        Assert.Equal(top, AgentRollup.Top(agents));
    }

    [Theory]
    [InlineData("blocked", 0)]
    [InlineData("error", 1)]
    [InlineData("done", 2)]
    [InlineData("working", 3)]
    [InlineData("idle", 4)]
    [InlineData("stopped", -1)]
    [InlineData("running", -1)]
    public void The_rank_orders_by_urgency_and_hides_stopped_or_unknown(string status, int rank)
    {
        Assert.Equal(rank, AgentRollup.Rank(status));
    }

    [Theory]
    [InlineData("blocked", false, "blocked", 2)]
    [InlineData("blocked", true, "blocked", 1)]
    [InlineData("done", false, "done", 1)]
    [InlineData("done", true, "done", 0)]
    [InlineData("working", false, "working", 0)]
    [InlineData("idle", false, null, 0)]
    public void The_badge_counts_urgent_agents_and_the_active_tab_hides_done(string status, bool active, string? dot, int count)
    {
        var summary = Summary(Agent("a1", status), Agent("a2", status == "blocked" ? "done" : "idle"));

        Assert.Equal(new TabBadge(dot, count), AgentRollup.Badge(summary, active));
    }

    [Fact]
    public void A_tab_without_a_summary_shows_nothing()
    {
        Assert.Equal(TabBadge.None, AgentRollup.Badge(null, active: false));
    }

    [Fact]
    public void The_popover_counts_agents_and_distinct_worktrees()
    {
        var summary = Summary(Agent("a1", "blocked", "br_wt-1"), Agent("a2", "working", "br_wt-2"), Agent("a3", "idle", "br_wt-2"));

        Assert.Equal("3 agents · 2 worktrees", AgentRollup.Counts(summary));
    }

    [Fact]
    public void The_popover_counts_skip_stopped_and_unknown_statuses()
    {
        var summary = Summary(Agent("a1", "working", "br_wt-1"), Agent("a2", "running", "br_wt-2"), Agent("a3", "stopped", "br_wt-3"));

        Assert.Equal("1 agent · 1 worktree", AgentRollup.Counts(summary));
    }

    [Theory]
    [InlineData("blocked", "Needs you")]
    [InlineData("error", "Error")]
    [InlineData("done", "Done")]
    [InlineData("working", "Working")]
    [InlineData("idle", "Idle")]
    public void Status_labels_match_the_web_wording(string status, string label)
    {
        Assert.Equal(label, AgentRollup.Label(status));
    }

    [Theory]
    [InlineData(1, "agent")]
    [InlineData(0, "agents")]
    [InlineData(3, "agents")]
    public void Only_one_is_singular(int n, string word)
    {
        Assert.Equal(word, AgentRollup.Plural(n, "agent", "agents"));
    }

    [Theory]
    [InlineData(72, "1:12")]
    [InlineData(5, "0:05")]
    [InlineData(3725, "1:02:05")]
    [InlineData(-3, "0:00")]
    public void The_turn_timer_reads_minutes_and_seconds(int seconds, string text)
    {
        Assert.Equal(text, AgentRollup.Clock(TimeSpan.FromSeconds(seconds)));
    }

    [Theory]
    [InlineData(20, "<1 min")]
    [InlineData(180, "3 min")]
    [InlineData(7300, "2 h")]
    public void The_waiting_time_is_coarse(int seconds, string text)
    {
        Assert.Equal(text, AgentRollup.Waiting(TimeSpan.FromSeconds(seconds)));
    }

    [Fact]
    public void Commands_match_the_desktop_channel_contract()
    {
        var select = JsonSerializer.Deserialize<Dictionary<string, string>>(AgentCommand.Select("a1"));
        var allow = JsonSerializer.Deserialize<Dictionary<string, string>>(AgentCommand.Allow("a1", "p_1"));

        Assert.Equal(new Dictionary<string, string> { ["type"] = "select-agent", ["id"] = "a1" }, select);
        Assert.Equal(new Dictionary<string, string> { ["type"] = "permission", ["id"] = "a1", ["request_id"] = "p_1", ["decision"] = "allow" }, allow);
    }
}

public class AgentBoardTests
{
    private static readonly (string, string)[] Order = [("t1", "t1"), ("t2", "t2"), ("t3", "t1")];

    private static AgentEntry Blocked(string id, int sinceMinutes) =>
        new(id, id, "blocked", null, null, null, null, DateTimeOffset.Parse("2026-11-05T10:00:00Z").AddMinutes(sinceMinutes));

    private static AgentSummary Summary(params AgentEntry[] agents) => new(agents);

    [Fact]
    public void Reporting_the_same_summary_twice_is_not_a_change()
    {
        var board = new AgentBoard();
        board.Report("t1", Summary(Blocked("a1", 0)));

        var changed = board.Report("t1", Summary(Blocked("a1", 0)));

        Assert.Equal(AgentChange.None, changed);
    }

    [Fact]
    public void A_new_blocked_agent_changes_the_tabs()
    {
        var board = new AgentBoard();
        board.Report("t1", Summary(Blocked("a1", 0)));

        var changed = board.Report("t1", Summary(Blocked("a1", 0), Blocked("a2", 1)));

        Assert.Equal(AgentChange.Tabs, changed);
    }

    [Fact]
    public void A_new_tool_call_is_an_activity_only_change()
    {
        var board = new AgentBoard();
        board.Report("t1", Summary(Working("a1", "Read")));

        var changed = board.Report("t1", Summary(Working("a1", "Edit")));

        Assert.Equal(AgentChange.Activity, changed);
    }

    private static AgentEntry Working(string id, string tool) =>
        new(id, id, "working", null, null, new AgentActivity(tool, "src/a.ts", null), null, null);

    [Fact]
    public void Blocked_agents_are_ordered_oldest_first_and_a_satellite_repeat_is_counted_once()
    {
        var board = new AgentBoard();
        board.Report("t1", Summary(Blocked("a1", 5), Blocked("a2", 1)));
        board.Report("t2", Summary(Blocked("a1", 3)));
        board.Report("t3", Summary(Blocked("a2", 1)));

        var blocked = board.Blocked(Order);

        Assert.Equal([("t1", "a2"), ("t2", "a1"), ("t1", "a1")], blocked.Select(b => (b.TabId, b.Agent.Id)));
    }

    [Fact]
    public void Next_cycles_round_robin_and_wraps()
    {
        var board = new AgentBoard();
        board.Report("t1", Summary(Blocked("a1", 5)));
        board.Report("t2", Summary(Blocked("b1", 1)));

        var visits = Enumerable.Range(0, 3).Select(_ => board.Next(Order)!.Agent.Id).ToList();

        Assert.Equal(["b1", "a1", "b1"], visits);
    }

    [Fact]
    public void Next_continues_after_the_last_agent_even_when_it_was_answered()
    {
        var board = new AgentBoard();
        board.Report("t1", Summary(Blocked("a1", 1), Blocked("a2", 2), Blocked("a3", 3)));
        board.Next(Order);
        board.Next(Order);
        board.Report("t1", Summary(Blocked("a1", 1), Blocked("a3", 3)));

        var next = board.Next(Order);

        Assert.Equal("a3", next?.Agent.Id);
    }

    [Fact]
    public void Next_is_null_when_nothing_waits()
    {
        Assert.Null(new AgentBoard().Next(Order));
    }
}

public class AgentControllerTests
{
    private static AgentSummary BlockedSummary(string id) =>
        new([new AgentEntry(id, id, "blocked", null, null, null, new AgentPermission("p_1", "Bash", "Bash(ls)", null), DateTimeOffset.Parse("2026-11-05T10:00:00Z"))]);

    [Fact]
    public void A_reported_summary_reaches_the_tab_snapshot_and_the_waiting_total()
    {
        using var h = new ShellHarness();
        var tab = h.Tabs.ActiveTab!;

        h.Controller.ReportAgents(tab.Id, BlockedSummary("a1"));

        Assert.Equal(BlockedSummary("a1"), h.Ui.Last.Tabs.Single().Agents);
        Assert.Equal(1, h.Ui.Last.Waiting);
    }

    [Fact]
    public void An_unchanged_summary_does_not_redraw_the_tabs()
    {
        using var h = new ShellHarness();
        var tab = h.Tabs.ActiveTab!;
        h.Controller.ReportAgents(tab.Id, BlockedSummary("a1"));
        var before = h.Ui.Snapshots.Count;

        h.Controller.ReportAgents(tab.Id, BlockedSummary("a1"));

        Assert.Equal(before, h.Ui.Snapshots.Count);
    }

    [Fact]
    public void An_activity_only_change_refreshes_the_popover_without_redrawing_the_tabs()
    {
        using var h = new ShellHarness();
        var tab = h.Tabs.ActiveTab!;
        h.Controller.ReportAgents(tab.Id, WorkingSummary("Read"));
        var before = h.Ui.Snapshots.Count;

        h.Controller.ReportAgents(tab.Id, WorkingSummary("Edit"));

        Assert.Equal(before, h.Ui.Snapshots.Count);
        Assert.Equal((tab.Id, WorkingSummary("Edit")), Assert.Single(h.Ui.AgentUpdates));
    }

    private static AgentSummary WorkingSummary(string tool) =>
        new([new AgentEntry("a1", "a1", "working", null, null, new AgentActivity(tool, null, null), null, null)]);

    [Fact]
    public void Focusing_the_next_blocked_agent_switches_tab_and_selects_it_on_that_page()
    {
        using var h = new ShellHarness();
        var waiting = h.Tabs.ActiveTab!;
        h.Controller.ReportAgents(waiting.Id, BlockedSummary("a1"));
        h.Controller.NewTab();

        var next = h.Controller.FocusNextBlocked();

        Assert.Equal("a1", next?.Agent.Id);
        Assert.Equal(waiting, h.Tabs.ActiveTab);
        Assert.Equal((waiting, """{"type":"select-agent","id":"a1"}"""), Assert.Single(h.Ui.AgentCommands));
    }

    [Fact]
    public void Allowing_a_permission_sends_the_decision_to_the_reporting_page_without_switching()
    {
        using var h = new ShellHarness();
        var waiting = h.Tabs.ActiveTab!;
        var other = h.Controller.NewTab();

        h.Controller.AllowPermission(waiting.Id, "a1", "p_1");

        Assert.Equal(other, h.Tabs.ActiveTab);
        Assert.Equal((waiting, """{"type":"permission","id":"a1","request_id":"p_1","decision":"allow"}"""), Assert.Single(h.Ui.AgentCommands));
    }

    [Fact]
    public async Task Closing_a_tab_drops_its_summary_from_the_waiting_total()
    {
        using var h = new ShellHarness();
        var waiting = h.Tabs.ActiveTab!;
        h.Controller.ReportAgents(waiting.Id, BlockedSummary("a1"));

        await h.Controller.CloseTabAsync(waiting.Id);

        Assert.Equal(0, h.Ui.Last.Waiting);
    }

    [Fact]
    public void A_page_reset_drops_the_tab_summary_and_redraws_the_tabs()
    {
        using var h = new ShellHarness();
        var waiting = h.Tabs.ActiveTab!;
        h.Controller.ReportAgents(waiting.Id, BlockedSummary("a1"));

        h.Controller.PageReset(waiting.Id);

        Assert.Equal(0, h.Ui.Last.Waiting);
        Assert.Null(h.Ui.Last.Tabs.Single().Agents);
        Assert.Null(h.Controller.FocusNextBlocked());
    }

    [Fact]
    public async Task A_crashed_bridge_drops_the_summaries_of_its_tab()
    {
        using var h = new ShellHarness();
        var tab = h.Tabs.ActiveTab!;
        await h.Controller.OpenRepoAsync("/repos/atlas", tab.Id);
        h.Controller.ReportAgents(tab.Id, BlockedSummary("a1"));

        h.Launcher.Started[0].Exit("bridge exited (code 1)");

        await ShellHarness.Eventually(() => h.Launcher.Started.Count == 2);
        Assert.Equal(0, h.Ui.Last.Waiting);
        Assert.Null(h.Ui.Last.Tabs.Single().Agents);
    }

    [Fact]
    public async Task A_bridge_that_cannot_be_respawned_shows_the_error_without_a_stale_waiting_pill()
    {
        using var h = new ShellHarness();
        var tab = h.Tabs.ActiveTab!;
        await h.Controller.OpenRepoAsync("/repos/atlas", tab.Id);
        h.Controller.ReportAgents(tab.Id, BlockedSummary("a1"));
        h.Launcher.OnStart = p => p.Exit("bridge exited (code 3)");

        h.Launcher.Started[0].Exit("bridge exited (code 1)");

        await ShellHarness.Eventually(() => h.Ui.TabErrors.Count == 1);
        Assert.Equal(0, h.Ui.Last.Waiting);
    }

    [Fact]
    public async Task Navigating_an_open_project_to_a_worktree_drops_its_old_summary()
    {
        using var h = new ShellHarness();
        var first = h.Tabs.ActiveTab!;
        await h.Controller.OpenRepoAsync("/repos/atlas", first.Id);
        h.Controller.ReportAgents(first.Id, BlockedSummary("a1"));

        await h.Controller.OpenRepoAsync("/repos/atlas", null, "br_feature");

        Assert.Equal(0, h.Ui.Last.Waiting);
    }
}
