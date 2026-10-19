using System.Net;
using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests;

public class OpenRepoFlowTests
{
    [Fact]
    public async Task Opening_a_repo_starts_its_bridge_and_navigates_the_requesting_tab_to_the_main_workspace()
    {
        using var h = new ShellHarness();
        var tab = h.Tabs.ActiveTab!;

        await h.Controller.OpenRepoAsync("/repos/atlas", tab.Id);

        Assert.Single(h.Tabs.Tabs);
        Assert.Equal("/repos/atlas", tab.RepoPath);
        Assert.True(tab.OwnsBridge);
        Assert.Equal([(tab, "http://127.0.0.1:41000/?workspace=main")], h.Ui.Navigations);
        Assert.Equal(41000, Assert.Single(h.Launcher.Started).Spec.Port);
    }

    [Theory]
    [InlineData(null, "main")]
    [InlineData("pr-7", "pr-7")]
    [InlineData("agent one", "agent%20one")]
    public async Task A_requested_workspace_boots_the_canvas_straight_into_it_and_main_is_the_default(string? workspace, string expected)
    {
        using var h = new ShellHarness();

        await h.Controller.OpenRepoAsync("/repos/atlas", h.Tabs.ActiveTab!.Id, workspace);

        Assert.EndsWith($"/?workspace={expected}", h.Ui.Navigations.Single().Url);
    }

    [Fact]
    public async Task A_tab_that_already_shows_a_repo_is_not_reused_a_new_tab_opens_instead()
    {
        using var h = new ShellHarness();
        var first = h.Tabs.ActiveTab!;
        await h.Controller.OpenRepoAsync("/repos/atlas", first.Id);

        await h.Controller.OpenRepoAsync("/repos/zeta", first.Id);

        Assert.Equal(2, h.Tabs.Tabs.Count);
        Assert.Equal("/repos/zeta", h.Tabs.ActiveTab!.RepoPath);
        Assert.Equal("/repos/atlas", first.RepoPath);
        Assert.Equal(2, h.Launcher.Started.Count);
    }

    [Fact]
    public async Task Opening_the_same_repo_twice_focuses_its_tab_and_never_starts_a_second_bridge()
    {
        using var h = new ShellHarness();
        var first = h.Tabs.ActiveTab!;
        await h.Controller.OpenRepoAsync("/repos/atlas", first.Id);
        var other = h.Tabs.NewTab();

        await h.Controller.OpenRepoAsync("/repos/atlas", other.Id, "main");

        Assert.Single(h.Launcher.Started);
        Assert.Contains(first.Id, h.Ui.Surfaced);
        Assert.Null(other.RepoPath);
    }

    [Fact]
    public async Task Progress_lines_from_the_bridge_reach_the_requesting_tab()
    {
        using var h = new ShellHarness();
        h.Launcher.OnStart = p => { p.Say("analyzing /repos/atlas"); p.Say("[codechroma-live] bridge ready at x"); };
        var tab = h.Tabs.ActiveTab!;

        await h.Controller.OpenRepoAsync("/repos/atlas", tab.Id);

        Assert.Equal(["analyzing /repos/atlas", "[codechroma-live] bridge ready at x"], h.Ui.Progress.Where(p => p.Tab == tab).Select(p => p.Line));
    }

    [Fact]
    public async Task A_bridge_that_fails_to_start_is_reported_on_the_tab_and_nothing_is_recorded()
    {
        using var h = new ShellHarness();
        h.Launcher.OnStart = p => p.Exit("bridge exited (code 3)");
        var tab = h.Tabs.ActiveTab!;

        await h.Controller.OpenRepoAsync("/repos/atlas", tab.Id);

        Assert.Contains("bridge exited (code 3)", Assert.Single(h.Ui.TabErrors).Message);
        Assert.Null(tab.RepoPath);
        Assert.Empty(h.Ui.Navigations);
        Assert.Empty(RecentRepos.Read(h.RecentsPath));
    }

    [Fact]
    public async Task A_started_repo_is_added_to_the_recent_list()
    {
        using var h = new ShellHarness();

        await h.Controller.OpenRepoAsync("/repos/atlas", h.Tabs.ActiveTab!.Id);

        Assert.Equal(["/repos/atlas"], RecentRepos.Read(h.RecentsPath).Select(r => r.Path));
    }

    [Fact]
    public async Task The_window_title_and_tab_strip_show_the_active_project_and_the_app_version()
    {
        using var h = new ShellHarness();

        await h.Controller.OpenRepoAsync("/repos/atlas", h.Tabs.ActiveTab!.Id);

        Assert.Equal("atlas [Main] - CodeChroma 0.12.1", h.Ui.Last.WindowTitle);
        Assert.Equal(["atlas [Main]"], h.Ui.Last.Tabs.Select(t => t.Title));
        Assert.Equal(h.Tabs.ActiveTab!.Id, h.Ui.Last.ActiveId);
    }

    [Fact]
    public void An_empty_window_is_titled_with_just_the_product_and_version()
    {
        using var h = new ShellHarness();

        Assert.Equal("New Tab - CodeChroma 0.12.1", h.Ui.Last.WindowTitle);
    }
}

public class BranchPickerFlowTests
{
    private static async Task<(ShellHarness, Tab)> OpenAtlas()
    {
        var h = new ShellHarness();
        var owner = h.Tabs.ActiveTab!;
        await h.Controller.OpenRepoAsync("/repos/atlas", owner.Id);
        h.Ui.Navigations.Clear();
        return (h, owner);
    }

    [Fact]
    public async Task Reopening_an_open_project_offers_the_branches_and_a_chosen_branch_opens_in_its_own_tab_on_the_same_bridge()
    {
        var (h, owner) = await OpenAtlas();
        h.Ui.NextPick = new BranchPick.Existing("feature");

        await h.Controller.OpenRepoAsync("/repos/atlas", null);

        var tab = h.Tabs.ActiveTab!;
        Assert.Equal("atlas", h.Ui.PickedProject);
        Assert.Equal(owner.Id, tab.OwnerTabId);
        Assert.Equal("br_feature", tab.WorkspaceId);
        Assert.Equal([(tab, owner.Bridge!.Origin + "/?workspace=br_feature")], h.Ui.Navigations);
        Assert.Single(h.Launcher.Started);
        Assert.Equal("atlas [feature]", h.Ui.Last.Tabs.Single(t => t.Id == tab.Id).Title);
        h.Dispose();
    }

    [Fact]
    public async Task A_new_branch_pick_is_sent_with_its_start_point()
    {
        var (h, _) = await OpenAtlas();
        string? body = null;
        h.BranchResponder = request =>
        {
            if (request.Method == HttpMethod.Post) body = request.Content!.ReadAsStringAsync().Result;
            return request.Method == HttpMethod.Get
                ? StubHandler.Json(HttpStatusCode.OK, """{"current":"main","branches":[]}""")
                : StubHandler.Json(HttpStatusCode.OK, """{"id":"br_x","branch":"x","worktree":"/wt/x"}""");
        };
        h.Ui.NextPick = new BranchPick.New("x", "main");

        await h.Controller.OpenRepoAsync("/repos/atlas", null);

        Assert.Contains("\"new_branch\":\"x\"", body);
        Assert.Contains("\"start_point\":\"main\"", body);
        h.Dispose();
    }

    [Fact]
    public async Task Cancelling_the_picker_only_focuses_the_open_project()
    {
        var (h, owner) = await OpenAtlas();

        await h.Controller.OpenRepoAsync("/repos/atlas", null);

        Assert.Single(h.Tabs.Tabs);
        Assert.Contains(owner.Id, h.Ui.Surfaced);
        Assert.DoesNotContain("POST /branches", h.BranchRequests);
        h.Dispose();
    }

    [Fact]
    public async Task A_branch_held_by_another_workspace_focuses_that_workspace_tab()
    {
        var (h, owner) = await OpenAtlas();
        var held = h.Tabs.AddWorkspaceTab(owner.Id, "br_feature", "feature");
        h.Tabs.SetActive(owner.Id);
        h.BranchResponder = request => request.Method == HttpMethod.Get
            ? StubHandler.Json(HttpStatusCode.OK, """{"current":"main","branches":[]}""")
            : StubHandler.Json(HttpStatusCode.Conflict, """{"detail":{"workspace":"br_feature","message":"branch is already open"}}""");
        h.Ui.NextPick = new BranchPick.Existing("feature");

        await h.Controller.OpenRepoAsync("/repos/atlas", null);

        Assert.Equal(held.Id, h.Ui.Surfaced[^1]);
        Assert.Equal(2, h.Tabs.Tabs.Count);
        h.Dispose();
    }

    [Fact]
    public async Task A_failed_branch_request_shows_an_error_and_opens_nothing()
    {
        var (h, _) = await OpenAtlas();
        h.BranchResponder = request => request.Method == HttpMethod.Get
            ? StubHandler.Json(HttpStatusCode.OK, """{"current":"main","branches":[]}""")
            : StubHandler.Json(HttpStatusCode.BadRequest, """{"detail":"not a git repository"}""");
        h.Ui.NextPick = new BranchPick.Existing("feature");

        await h.Controller.OpenRepoAsync("/repos/atlas", null);

        Assert.Equal(("Could not open the branch", "not a git repository"), Assert.Single(h.Ui.Errors));
        Assert.Single(h.Tabs.Tabs);
        h.Dispose();
    }

    [Fact]
    public async Task A_bridge_that_cannot_list_branches_just_focuses_the_open_tab()
    {
        var (h, owner) = await OpenAtlas();
        h.BranchResponder = _ => new HttpResponseMessage(HttpStatusCode.NotFound);
        h.Ui.NextPick = new BranchPick.Existing("feature");

        await h.Controller.OpenRepoAsync("/repos/atlas", null);

        Assert.Null(h.Ui.PickedProject);
        Assert.Contains(owner.Id, h.Ui.Surfaced);
        h.Dispose();
    }
}

public class WorkspaceTabFlowTests
{
    [Fact]
    public async Task A_pr_tab_opens_on_the_senders_bridge_without_starting_another_one()
    {
        using var h = new ShellHarness();
        var owner = h.Tabs.ActiveTab!;
        await h.Controller.OpenRepoAsync("/repos/atlas", owner.Id);

        await h.Controller.OpenWorkspaceTabAsync(owner.Id, "pr-7");

        var pr = h.Tabs.FindWorkspaceTab("pr-7")!;
        Assert.Single(h.Launcher.Started);
        Assert.Equal(owner.Bridge!.Origin + "/?workspace=pr-7", h.Ui.Navigations[^1].Url);
        Assert.False(pr.OwnsBridge);
        Assert.Equal("atlas [PR #7]", h.Ui.Last.Tabs.Single(t => t.Id == pr.Id).Title);
    }

    [Fact]
    public async Task A_workspace_requested_from_a_workspace_tab_attaches_to_the_same_owner()
    {
        using var h = new ShellHarness();
        var owner = h.Tabs.ActiveTab!;
        await h.Controller.OpenRepoAsync("/repos/atlas", owner.Id);
        await h.Controller.OpenWorkspaceTabAsync(owner.Id, "pr-7");
        var pr = h.Tabs.FindWorkspaceTab("pr-7")!;

        await h.Controller.OpenWorkspaceTabAsync(pr.Id, "pr-8");

        Assert.Equal(owner.Id, h.Tabs.FindWorkspaceTab("pr-8")!.OwnerTabId);
    }

    [Fact]
    public async Task Asking_again_for_an_open_pr_focuses_its_tab_instead_of_duplicating_it()
    {
        using var h = new ShellHarness();
        var owner = h.Tabs.ActiveTab!;
        await h.Controller.OpenRepoAsync("/repos/atlas", owner.Id);
        await h.Controller.OpenWorkspaceTabAsync(owner.Id, "pr-7");
        var pr = h.Tabs.FindWorkspaceTab("pr-7")!;

        await h.Controller.OpenWorkspaceTabAsync(owner.Id, "pr-7");

        Assert.Equal(2, h.Tabs.Tabs.Count);
        Assert.Equal(pr.Id, h.Ui.Surfaced[^1]);
    }

    [Fact]
    public async Task Closing_the_pr_tab_by_workspace_id_leaves_the_bridge_running_and_closing_the_owner_stops_it()
    {
        using var h = new ShellHarness();
        var owner = h.Tabs.ActiveTab!;
        await h.Controller.OpenRepoAsync("/repos/atlas", owner.Id);
        await h.Controller.OpenWorkspaceTabAsync(owner.Id, "pr-7");

        await h.Controller.CloseWorkspaceTabAsync("pr-7");
        var stoppedAfterPr = h.Launcher.Started[0].StopCalled;
        await h.Controller.CloseTabAsync(owner.Id);

        Assert.False(stoppedAfterPr);
        Assert.True(h.Launcher.Started[0].StopCalled);
    }

    [Fact]
    public async Task Closing_the_last_tab_leaves_a_fresh_empty_one_and_releases_the_view()
    {
        using var h = new ShellHarness();
        var owner = h.Tabs.ActiveTab!;
        await h.Controller.OpenRepoAsync("/repos/atlas", owner.Id);

        await h.Controller.CloseProjectAsync(owner.Id);

        Assert.Contains(owner.View, h.Ui.ClosedViews);
        Assert.Null(Assert.Single(h.Tabs.Tabs).RepoPath);
        Assert.Equal("New Tab - CodeChroma 0.12.1", h.Ui.Last.WindowTitle);
    }

    [Fact]
    public async Task Focusing_a_tab_by_the_canvas_surfaces_that_tab()
    {
        using var h = new ShellHarness();
        var first = h.Tabs.ActiveTab!;
        h.Controller.NewTab();

        h.Controller.FocusTab(first.Id);

        Assert.Equal(first.Id, h.Tabs.ActiveTab!.Id);
        Assert.Equal(first.Id, h.Ui.Surfaced[^1]);
        await Task.CompletedTask;
    }
}

public class BridgeRespawnFlowTests
{
    [Fact]
    public async Task A_crashed_bridge_is_respawned_and_its_tab_and_pr_tabs_follow_it()
    {
        using var h = new ShellHarness();
        var a = h.Tabs.ActiveTab!;
        await h.Controller.OpenRepoAsync("/repos/a", a.Id);
        await h.Controller.OpenWorkspaceTabAsync(a.Id, "pr-7");
        var pr = h.Tabs.FindWorkspaceTab("pr-7")!;
        var oldOrigin = a.Bridge!.Origin;
        h.Ui.Navigations.Clear();

        h.Launcher.Started[0].Exit("bridge exited (code 1)");
        await ShellHarness.Eventually(() => a.Bridge!.Origin != oldOrigin && h.Ui.Navigations.Count == 2);

        Assert.Equal(2, h.Launcher.Started.Count);
        Assert.Equal(a.Bridge!.Origin + "/?workspace=main", h.Ui.Navigations.Single(n => n.Tab == a).Url);
        Assert.Equal(a.Bridge.Origin + "/?workspace=pr-7", h.Ui.Navigations.Single(n => n.Tab == pr).Url);
        Assert.Same(a.Bridge, h.Tabs.BridgeFor(pr));
    }

    [Fact]
    public async Task Only_the_crashed_repos_bridge_is_respawned()
    {
        using var h = new ShellHarness();
        var a = h.Tabs.ActiveTab!;
        await h.Controller.OpenRepoAsync("/repos/a", a.Id);
        await h.Controller.OpenRepoAsync("/repos/b", null);
        var b = h.Tabs.FindByRepoPath("/repos/b")!;
        var bridgeB = b.Bridge;

        h.Launcher.Started[0].Exit("bridge exited (code 1)");
        await ShellHarness.Eventually(() => h.Launcher.Started.Count == 3);

        Assert.Same(bridgeB, b.Bridge);
        Assert.False(h.Launcher.Started[1].HasExited);
    }

    [Fact]
    public async Task A_bridge_stopped_by_closing_its_tab_is_not_respawned()
    {
        using var h = new ShellHarness();
        var a = h.Tabs.ActiveTab!;
        await h.Controller.OpenRepoAsync("/repos/a", a.Id);

        await h.Controller.CloseTabAsync(a.Id);
        await Task.Delay(150);

        Assert.Single(h.Launcher.Started);
    }

    [Fact]
    public async Task A_respawn_that_fails_is_reported_on_the_tab()
    {
        using var h = new ShellHarness();
        var a = h.Tabs.ActiveTab!;
        await h.Controller.OpenRepoAsync("/repos/a", a.Id);
        h.Launcher.OnStart = p => p.Exit("bridge exited (code 9)");

        h.Launcher.Started[0].Exit("bridge exited (code 1)");
        await ShellHarness.Eventually(() => h.Ui.TabErrors.Count == 1);

        Assert.Contains("code 9", h.Ui.TabErrors[0].Message);
    }

    [Fact]
    public async Task Shutting_down_stops_every_bridge_and_does_not_respawn_them()
    {
        using var h = new ShellHarness();
        await h.Controller.OpenRepoAsync("/repos/a", h.Tabs.ActiveTab!.Id);
        await h.Controller.OpenRepoAsync("/repos/b", null);

        await h.Controller.ShutdownAsync();
        await Task.Delay(150);

        Assert.All(h.Launcher.Started, p => Assert.True(p.StopCalled));
        Assert.Equal(2, h.Launcher.Started.Count);
    }
}
