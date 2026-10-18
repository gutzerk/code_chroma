namespace CodeChroma.Shell;

public sealed record TabInfo(string Id, string Title);

public sealed record TabsSnapshot(IReadOnlyList<TabInfo> Tabs, string? ActiveId, string WindowTitle);

public abstract record BranchPick
{
    public sealed record Cancel : BranchPick;

    public sealed record Existing(string Name) : BranchPick;

    public sealed record New(string Name, string? From) : BranchPick;
}

/// <summary>What the controller needs from the toolkit: render tabs, drive a tab's WebView, and ask the user things.</summary>
public interface IShellUi
{
    void TabsChanged(TabsSnapshot snapshot);

    void Navigate(Tab tab, string url);

    void ShowProgress(Tab tab, string line);

    void ShowTabError(Tab tab, string message);

    void Surface(Tab tab);

    void CloseView(object view);

    void ShowError(string title, string message);

    Task<BranchPick> PickBranchAsync(string project, BranchChoices choices);
}
