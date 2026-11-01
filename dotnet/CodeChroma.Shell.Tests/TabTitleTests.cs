namespace CodeChroma.Shell.Tests;

public class TabTitleTests
{
    private static BridgeHandle Bridge() =>
        new(43000, "http://127.0.0.1:43000", new FakeProcess(new BridgeLaunchSpec("b", "/r", 43000, _ => { })));

    [Fact]
    public void An_empty_tab_is_called_new_tab()
    {
        var model = new TabModel(() => new object());
        var tab = model.NewTab();

        Assert.Equal("New Tab", TabTitles.For(model, tab));
    }

    [Theory]
    [InlineData("/work/atlas", "atlas")]
    [InlineData("/work/atlas/", "atlas")]
    [InlineData("C:\\work\\atlas", "atlas")]
    public void A_repo_tab_shows_the_folder_name_and_main(string repo, string expected)
    {
        var model = new TabModel(() => new object());
        var tab = model.NewTab();
        model.AssignRepo(tab.Id, repo, Bridge());

        Assert.Equal(expected, TabTitles.For(model, tab));
    }

    [Theory]
    [InlineData("pr-42", null, "atlas [PR #42]")]
    [InlineData("pr-42", "feature-x", "atlas [feature-x]")]
    [InlineData("br_feature", "feature-x", "atlas [feature-x]")]
    public void A_workspace_tab_names_its_owner_project_and_its_own_label(string workspaceId, string? label, string expected)
    {
        var model = new TabModel(() => new object());
        var owner = model.NewTab();
        model.AssignRepo(owner.Id, "/work/atlas", Bridge());
        var tab = model.AddWorkspaceTab(owner.Id, workspaceId, label);

        Assert.Equal(expected, TabTitles.For(model, tab));
    }

    [Fact]
    public void A_workspace_tab_with_no_known_owner_repo_falls_back_to_its_label()
    {
        var model = new TabModel(() => new object());
        var empty = model.NewTab();
        var tab = model.AddWorkspaceTab(empty.Id, "pr-7");

        Assert.Equal("PR #7", TabTitles.For(model, tab));
    }
}
