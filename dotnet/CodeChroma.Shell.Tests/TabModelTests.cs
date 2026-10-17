namespace CodeChroma.Shell.Tests;

public class TabModelTests
{
    private sealed class View;

    private static int port = 42000;

    private static BridgeHandle Bridge()
    {
        port++;
        return new BridgeHandle(port, $"http://127.0.0.1:{port}", new FakeProcess(new BridgeLaunchSpec("b", "/r", port, _ => { })));
    }

    private static (TabModel, List<object>) Make()
    {
        var views = new List<object>();
        return (new TabModel(() => { var v = new View(); views.Add(v); return v; }), views);
    }

    private static Tab Open(TabModel model, string repo, BridgeHandle? bridge = null)
    {
        var tab = model.NewTab();
        model.AssignRepo(tab.Id, repo, bridge ?? Bridge());
        return tab;
    }

    [Fact]
    public void A_new_tab_is_empty_active_and_gets_a_view_from_the_factory()
    {
        var (model, views) = Make();

        var tab = model.NewTab();

        Assert.Null(tab.RepoPath);
        Assert.Null(tab.Bridge);
        Assert.Same(tab, model.ActiveTab);
        Assert.Equal([tab.View], views);
    }

    [Fact]
    public void Two_repos_live_in_two_tabs_each_with_its_own_bridge()
    {
        var (model, _) = Make();
        var a = Open(model, "/repos/atlas");
        var b = Open(model, "/repos/other");

        Assert.Equal(2, model.Tabs.Count);
        Assert.Same(a, model.FindByRepoPath("/repos/atlas"));
        Assert.Same(b, model.FindByRepoPath("/repos/other"));
        Assert.Equal([a.Bridge, b.Bridge], model.AllBridges());
        Assert.Null(model.FindByRepoPath("/repos/unknown"));
    }

    [Fact]
    public void A_repo_reached_through_a_link_is_found_under_its_real_path()
    {
        using var temp = new Support.TempDir();
        var real = temp.Dir("real-repo");
        var link = temp.Sub("linked-repo");
        try { Directory.CreateSymbolicLink(link, real); }
        catch (Exception e) when (e is UnauthorizedAccessException or IOException) { return; }
        var (model, _) = Make();
        var tab = Open(model, real);

        Assert.Same(tab, model.FindByRepoPath(link));
    }

    [Fact]
    public void Closing_a_tab_stops_only_its_own_bridge()
    {
        var (model, _) = Make();
        var a = Open(model, "/repos/a");
        var b = Open(model, "/repos/b");

        var outcome = model.CloseTab(a.Id)!;

        Assert.Same(a.Bridge, outcome.BridgeToStop);
        Assert.Equal([b.Bridge], model.AllBridges());
    }

    [Fact]
    public void Closing_an_unknown_tab_does_nothing() => Assert.Null(Make().Item1.CloseTab("nope"));

    [Fact]
    public void Closing_the_last_tab_opens_a_fresh_empty_one()
    {
        var (model, _) = Make();
        var only = Open(model, "/repos/a");

        var outcome = model.CloseTab(only.Id)!;

        Assert.NotNull(outcome.FallbackTab);
        Assert.Single(model.Tabs);
        Assert.Same(outcome.FallbackTab, model.ActiveTab);
        Assert.Null(outcome.FallbackTab!.RepoPath);
    }

    [Fact]
    public void Closing_the_active_tab_activates_a_neighbour()
    {
        var (model, _) = Make();
        var a = Open(model, "/repos/a");
        var b = Open(model, "/repos/b");
        var c = Open(model, "/repos/c");
        model.SetActive(b.Id);

        var outcome = model.CloseTab(b.Id)!;

        Assert.Same(c, outcome.ActiveTab);
        Assert.Contains(a, model.Tabs);
    }

    [Fact]
    public void Satellite_windows_close_with_their_tab_and_are_found_by_sender()
    {
        var (model, _) = Make();
        var tab = Open(model, "/repos/a");
        var window = new View();
        model.RegisterSatellite(tab.Id, "pr-7", window);

        Assert.Same(tab, model.FindTabBySender(window));
        Assert.Same(tab, model.FindTabBySender(tab.View));
        Assert.Null(model.FindTabBySender(new View()));
        Assert.Same(window, model.FindSatellite(tab.Id, "pr-7"));
        Assert.Equal([window], model.CloseTab(tab.Id)!.SatellitesToClose);
    }

    [Fact]
    public void Releasing_a_satellite_is_idempotent_and_leaves_the_bridge_alone()
    {
        var (model, _) = Make();
        var tab = Open(model, "/repos/a");
        var window = new View();
        model.RegisterSatellite(tab.Id, "pr-7", window);

        model.ReleaseSatellite(window);
        model.ReleaseSatellite(window);

        Assert.Null(model.FindSatellite(tab.Id, "pr-7"));
        Assert.NotNull(model.FindTab(tab.Id)!.Bridge);
    }

    [Fact]
    public void A_pr_tab_shares_the_owner_bridge_without_owning_it()
    {
        var (model, _) = Make();
        var owner = Open(model, "/repos/a");

        var pr = model.AddWorkspaceTab(owner.Id, "pr-7");

        Assert.Same(owner.Bridge, pr.Bridge);
        Assert.False(pr.OwnsBridge);
        Assert.Equal("pr-7", pr.WorkspaceId);
        Assert.Same(pr, model.ActiveTab);
        Assert.Same(pr, model.FindWorkspaceTab("pr-7"));
    }

    [Fact]
    public void Closing_a_pr_tab_leaves_the_shared_bridge_running_and_closing_the_owner_stops_it()
    {
        var (model, _) = Make();
        var owner = Open(model, "/repos/a");
        var pr = model.AddWorkspaceTab(owner.Id, "pr-7");

        var closedPr = model.CloseTab(pr.Id)!;
        var closedOwner = model.CloseTab(owner.Id)!;

        Assert.Null(closedPr.BridgeToStop);
        Assert.Same(owner.Bridge, closedOwner.BridgeToStop);
    }

    [Fact]
    public void A_pr_tab_follows_the_owner_to_its_respawned_bridge()
    {
        var (model, _) = Make();
        var owner = Open(model, "/repos/a");
        var pr = model.AddWorkspaceTab(owner.Id, "pr-7");
        var respawned = Bridge();

        model.ReplaceBridge(owner.Id, respawned);

        Assert.Same(respawned, model.BridgeFor(pr));
        Assert.Same(respawned, model.BridgeFor(owner));
    }

    [Fact]
    public void A_workspace_tab_can_carry_a_label_and_a_bridgeless_owner_gives_a_bridgeless_tab()
    {
        var (model, _) = Make();
        var empty = model.NewTab();

        var tab = model.AddWorkspaceTab(empty.Id, "br_feature", "feature-x");

        Assert.Equal("feature-x", tab.Label);
        Assert.Null(tab.Bridge);
    }
}
