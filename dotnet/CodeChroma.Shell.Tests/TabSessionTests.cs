using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests;

public class TabSessionTests
{
    private static void Save(ShellHarness h, int active, params SessionTab[] tabs) =>
        TabSession.Write(h.SessionPath, TabSession.Serialize(new SessionState(tabs, active)));

    private static void FailBridgeOf(ShellHarness h, string repo) => h.Launcher.OnStart = p =>
    {
        if (p.Spec.RepoPath == repo) p.Exit("bridge exited (code 3)");
        else p.Say($"[codechroma-live] bridge ready at http://127.0.0.1:{p.Spec.Port}");
    };

    [Fact]
    public async Task Opening_projects_saves_them_in_tab_order_with_the_active_one()
    {
        using var h = new ShellHarness();
        var alpha = h.Repo("alpha");
        var beta = h.Repo("beta");

        await h.Controller.OpenRepoAsync(alpha, h.Tabs.ActiveTab!.Id);
        await h.Controller.OpenRepoAsync(beta, null);
        h.Controller.SwitchTab(h.Tabs.Tabs[0].Id);

        var saved = TabSession.Read(h.SessionPath);
        Assert.Equal([new SessionTab(alpha), new SessionTab(beta)], saved.Tabs);
        Assert.Equal(0, saved.ActiveIndex);
    }

    [Fact]
    public async Task Closing_a_tab_drops_it_from_the_session_and_launcher_tabs_are_never_saved()
    {
        using var h = new ShellHarness();
        var alpha = h.Repo("alpha");
        await h.Controller.OpenRepoAsync(alpha, h.Tabs.ActiveTab!.Id);
        h.Controller.NewTab();

        await h.Controller.CloseTabAsync(h.Tabs.Tabs[0].Id);

        Assert.Empty(TabSession.Read(h.SessionPath).Tabs);
    }

    [Fact]
    public async Task A_pr_workspace_tab_is_saved_under_its_project()
    {
        using var h = new ShellHarness();
        var alpha = h.Repo("alpha");
        await h.Controller.OpenRepoAsync(alpha, h.Tabs.ActiveTab!.Id);

        await h.Controller.OpenWorkspaceTabAsync(h.Tabs.ActiveTab!.Id, "pr-7", "PR #7: fix");

        var saved = TabSession.Read(h.SessionPath);
        Assert.Equal([new SessionTab(alpha), new SessionTab(alpha, "pr-7", "PR #7: fix")], saved.Tabs);
        Assert.Equal(1, saved.ActiveIndex);
    }

    [Fact]
    public async Task Restoring_reopens_saved_projects_in_order_reusing_the_launcher_and_activates_the_saved_tab()
    {
        using var h = new ShellHarness();
        var alpha = h.Repo("alpha");
        var beta = h.Repo("beta");
        Save(h, 1, new SessionTab(alpha), new SessionTab(beta));
        var launcher = h.Tabs.ActiveTab!;

        await h.Controller.RestoreSessionAsync();

        Assert.Equal([alpha, beta], h.Tabs.Tabs.Select(t => t.RepoPath));
        Assert.Equal(launcher, h.Tabs.Tabs[0]);
        Assert.Equal(beta, h.Tabs.ActiveTab!.RepoPath);
        Assert.Equal(2, h.Launcher.Started.Count);
    }

    [Fact]
    public async Task Restoring_skips_projects_whose_folder_is_gone_and_rewrites_the_session_without_them()
    {
        using var h = new ShellHarness();
        var alpha = h.Repo("alpha");
        var gone = Path.Combine(Path.GetDirectoryName(alpha)!, "gone");
        Save(h, 0, new SessionTab(gone), new SessionTab(alpha));

        await h.Controller.RestoreSessionAsync();

        Assert.Equal([alpha], h.Tabs.Tabs.Select(t => t.RepoPath));
        Assert.Equal([new SessionTab(alpha)], TabSession.Read(h.SessionPath).Tabs);
    }

    [Fact]
    public async Task Restoring_reopens_a_pr_workspace_tab_on_its_project_bridge_and_can_make_it_active()
    {
        using var h = new ShellHarness();
        var alpha = h.Repo("alpha");
        Save(h, 1, new SessionTab(alpha), new SessionTab(alpha, "pr-7", "PR #7: fix"));

        await h.Controller.RestoreSessionAsync();

        var workspace = h.Tabs.FindWorkspaceTab("pr-7")!;
        Assert.Equal(h.Tabs.Tabs[0].Id, workspace.OwnerTabId);
        Assert.Equal("PR #7: fix", workspace.Label);
        Assert.Equal(workspace, h.Tabs.ActiveTab);
        Assert.Equal((workspace, "http://127.0.0.1:41000/?workspace=pr-7"), h.Ui.Navigations[^1]);
    }

    [Fact]
    public async Task A_project_whose_bridge_fails_on_restore_stays_saved_after_later_changes()
    {
        using var h = new ShellHarness();
        var alpha = h.Repo("alpha");
        var beta = h.Repo("beta");
        FailBridgeOf(h, beta);
        Save(h, 0, new SessionTab(alpha), new SessionTab(beta), new SessionTab(beta, "pr-7", "PR #7: fix"));
        await h.Controller.RestoreSessionAsync();

        h.Controller.NewTab();

        Assert.Equal([new SessionTab(alpha), new SessionTab(beta), new SessionTab(beta, "pr-7", "PR #7: fix")], TabSession.Read(h.SessionPath).Tabs);
    }

    [Fact]
    public async Task Closing_the_error_tab_of_a_failed_restore_drops_its_saved_project()
    {
        using var h = new ShellHarness();
        var alpha = h.Repo("alpha");
        var beta = h.Repo("beta");
        FailBridgeOf(h, beta);
        Save(h, 0, new SessionTab(alpha), new SessionTab(beta));
        await h.Controller.RestoreSessionAsync();
        var errorTab = h.Ui.TabErrors.Single().Tab;

        await h.Controller.CloseTabAsync(errorTab.Id);

        Assert.Equal([new SessionTab(alpha)], TabSession.Read(h.SessionPath).Tabs);
    }

    [Fact]
    public async Task A_saved_active_pr_tab_does_not_take_focus_after_the_user_switched_tabs_during_restore()
    {
        using var h = new ShellHarness();
        var alpha = h.Repo("alpha");
        var beta = h.Repo("beta");
        Save(h, 2, new SessionTab(alpha), new SessionTab(beta), new SessionTab(alpha, "pr-7", "PR #7: fix"));
        var restore = h.Controller.RestoreSessionAsync();
        var alphaTab = h.Tabs.FindByRepoPath(alpha)!;

        h.Controller.SwitchTab(alphaTab.Id);
        await restore;

        Assert.NotNull(h.Tabs.FindWorkspaceTab("pr-7"));
        Assert.Equal(alphaTab, h.Tabs.ActiveTab);
    }

    [Fact]
    public async Task Restoring_with_no_saved_session_leaves_the_launcher_alone()
    {
        using var h = new ShellHarness();
        var launcher = h.Tabs.ActiveTab!;

        await h.Controller.RestoreSessionAsync();

        Assert.Equal([launcher], h.Tabs.Tabs);
        Assert.Empty(h.Launcher.Started);
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("{\"tabs\": [{\"repo\": \"relative/path\"}, 3]}")]
    public void A_corrupt_or_invalid_session_file_reads_as_empty(string content)
    {
        using var dir = new TempDir();
        var path = TabSession.StorePath(dir.Path);
        File.WriteAllText(path, content);

        var state = TabSession.Read(path);

        Assert.Empty(state.Tabs);
        Assert.Null(state.Active);
    }
}
