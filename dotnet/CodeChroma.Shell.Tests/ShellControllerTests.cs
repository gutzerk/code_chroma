using System.Net;
using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests;

public class OpenRepoFlowTests
{
    [Fact]
    public async Task Opening_after_switching_tabs_reuses_the_requesting_tab_and_leaves_the_other_launcher_empty()
    {
        using var h = new ShellHarness();
        var requesting = h.Tabs.ActiveTab!;
        var other = h.Controller.NewTab();

        await h.Controller.OpenRepoAsync("/repos/cloned", requesting.Id);

        Assert.Equal(2, h.Tabs.Tabs.Count);
        Assert.Equal("/repos/cloned", requesting.RepoPath);
        Assert.Null(other.RepoPath);
        Assert.Equal(requesting, Assert.Single(h.Ui.Navigations).Tab);
    }

    [Fact]
    public async Task Opening_a_repo_starts_its_bridge_and_navigates_the_requesting_tab_to_the_repo_root()
    {
        using var h = new ShellHarness();
        var tab = h.Tabs.ActiveTab!;

        await h.Controller.OpenRepoAsync("/repos/atlas", tab.Id);

        Assert.Single(h.Tabs.Tabs);
        Assert.Equal("/repos/atlas", tab.RepoPath);
        Assert.True(tab.OwnsBridge);
        Assert.Equal([(tab, "http://127.0.0.1:41000/")], h.Ui.Navigations);
        Assert.Equal(41000, Assert.Single(h.Launcher.Started).Spec.Port);
    }

    [Fact]
    public async Task Opening_a_repo_at_a_worktree_navigates_to_that_workspace()
    {
        using var h = new ShellHarness();

        await h.Controller.OpenRepoAsync("/repos/atlas", h.Tabs.ActiveTab!.Id, "br_feature");

        Assert.Equal("http://127.0.0.1:41000/?workspace=br_feature", h.Ui.Navigations.Single().Url);
    }

    [Fact]
    public async Task Opening_an_already_open_project_at_a_worktree_focuses_its_tab_and_navigates_it_there()
    {
        using var h = new ShellHarness();
        var first = h.Tabs.ActiveTab!;
        await h.Controller.OpenRepoAsync("/repos/atlas", first.Id);
        var other = h.Controller.NewTab();

        await h.Controller.OpenRepoAsync("/repos/atlas", other.Id, "br_feature");

        Assert.Equal(first, h.Tabs.ActiveTab);
        Assert.Equal((first, "http://127.0.0.1:41000/?workspace=br_feature"), h.Ui.Navigations[^1]);
        Assert.Single(h.Launcher.Started);
    }

    [Fact]
    public async Task Opening_an_already_open_project_without_a_worktree_only_focuses_it()
    {
        using var h = new ShellHarness();
        var first = h.Tabs.ActiveTab!;
        await h.Controller.OpenRepoAsync("/repos/atlas", first.Id);
        var other = h.Controller.NewTab();

        await h.Controller.OpenRepoAsync("/repos/atlas", other.Id);

        Assert.Equal(first, h.Tabs.ActiveTab);
        Assert.Single(h.Ui.Navigations);
    }

    [Fact]
    public async Task A_repo_tab_navigates_to_the_bridge_root_without_a_workspace_param()
    {
        using var h = new ShellHarness();

        await h.Controller.OpenRepoAsync("/repos/atlas", h.Tabs.ActiveTab!.Id);

        Assert.DoesNotContain("workspace", h.Ui.Navigations.Single().Url);
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

        await h.Controller.OpenRepoAsync("/repos/atlas", other.Id);

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

        Assert.Equal("atlas - CodeChroma 0.12.1", h.Ui.Last.WindowTitle);
        Assert.Equal(["atlas"], h.Ui.Last.Tabs.Select(t => t.Title));
        Assert.Equal(h.Tabs.ActiveTab!.Id, h.Ui.Last.ActiveId);
    }

    [Fact]
    public void An_empty_window_is_titled_with_just_the_product_and_version()
    {
        using var h = new ShellHarness();

        Assert.Equal("New Tab - CodeChroma 0.12.1", h.Ui.Last.WindowTitle);
    }
}

public class ReopenOpenProjectTests
{
    [Fact]
    public async Task Reopening_an_open_project_only_focuses_its_tab_without_a_prompt_or_new_tab()
    {
        using var h = new ShellHarness();
        var owner = h.Tabs.ActiveTab!;
        await h.Controller.OpenRepoAsync("/repos/atlas", owner.Id);
        h.Ui.Navigations.Clear();

        await h.Controller.OpenRepoAsync("/repos/atlas", null);

        Assert.Single(h.Tabs.Tabs);
        Assert.Contains(owner.Id, h.Ui.Surfaced);
        Assert.Empty(h.Ui.Navigations);
    }
}
