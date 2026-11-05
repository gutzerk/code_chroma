namespace CodeChroma.Shell;

public sealed record TabInfo(string Id, string Title, AgentSummary? Agents = null);

public sealed record TabsSnapshot(IReadOnlyList<TabInfo> Tabs, string? ActiveId, string WindowTitle, int Waiting = 0);

/// <summary>What the controller needs from the toolkit: render tabs, drive a tab's WebView.</summary>
public interface IShellUi
{
    void TabsChanged(TabsSnapshot snapshot);

    /// <summary>A tab's agents changed without touching its badge or the waiting set: refresh only the open popover.</summary>
    void AgentsChanged(string tabId, AgentSummary summary);

    void Navigate(Tab tab, string url);

    void ShowProgress(Tab tab, string line);

    void ShowTabError(Tab tab, string message);

    void Surface(Tab tab);

    void CloseView(object view);

    void ShowError(string title, string message);

    void SendAgentCommand(Tab tab, string json);
}
