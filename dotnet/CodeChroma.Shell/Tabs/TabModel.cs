namespace CodeChroma.Shell;

public sealed class Tab
{
    public required string Id { get; init; }
    public string? RepoPath { get; set; }
    public string? WorkspaceId { get; init; }
    public string? Label { get; init; }
    public string? OwnerTabId { get; init; }
    public bool OwnsBridge { get; set; }
    public required object View { get; init; }
    public BridgeHandle? Bridge { get; set; }
    public Dictionary<string, object> Satellites { get; } = [];
}

public sealed record CloseTabOutcome(object ClosedView, BridgeHandle? BridgeToStop, IReadOnlyList<object> SatellitesToClose, Tab? FallbackTab, Tab ActiveTab);

/// <summary>Tab bookkeeping independent of any UI toolkit: views are opaque tokens from the host.</summary>
public sealed class TabModel(Func<object> createView)
{
    private readonly List<Tab> tabs = [];
    private string? activeId;
    private int counter;

    public IReadOnlyList<Tab> Tabs => [.. tabs];

    public Tab? ActiveTab => tabs.FirstOrDefault(t => t.Id == activeId);

    public Tab? FindTab(string tabId) => tabs.FirstOrDefault(t => t.Id == tabId);

    public Tab? FindByRepoPath(string repoPath)
    {
        var target = RepoPaths.Canonical(repoPath);
        return tabs.FirstOrDefault(t => t.RepoPath is not null && RepoPaths.Canonical(t.RepoPath) == target);
    }

    public Tab? FindWorkspaceTab(string workspaceId) => tabs.FirstOrDefault(t => t.WorkspaceId == workspaceId && t.RepoPath is null);

    public Tab? FindTabBySender(object sender) =>
        tabs.FirstOrDefault(t => ReferenceEquals(t.View, sender) || t.Satellites.Values.Any(s => ReferenceEquals(s, sender)));

    public Tab NewTab()
    {
        var tab = new Tab { Id = $"tab-{++counter}", View = createView() };
        return Add(tab);
    }

    public Tab AddWorkspaceTab(string ownerId, string workspaceId, string? label = null)
    {
        var owner = FindTab(ownerId);
        var tab = new Tab { Id = $"tab-{++counter}", WorkspaceId = workspaceId, Label = label, OwnerTabId = ownerId, View = createView(), Bridge = owner?.Bridge };
        return Add(tab);
    }

    private Tab Add(Tab tab)
    {
        tabs.Add(tab);
        activeId = tab.Id;
        return tab;
    }

    public void AssignRepo(string tabId, string repoPath, BridgeHandle bridge)
    {
        if (FindTab(tabId) is not { } tab) return;
        tab.RepoPath = repoPath;
        tab.Bridge = bridge;
        tab.OwnsBridge = true;
    }

    public void ReplaceBridge(string ownerTabId, BridgeHandle bridge)
    {
        if (FindTab(ownerTabId) is { } tab) tab.Bridge = bridge;
    }

    public BridgeHandle? BridgeFor(Tab tab) =>
        tab.OwnerTabId is not null && FindTab(tab.OwnerTabId) is { } owner ? owner.Bridge : tab.Bridge;

    public Tab? SetActive(string tabId)
    {
        var tab = FindTab(tabId);
        if (tab is not null) activeId = tab.Id;
        return tab;
    }

    public void RegisterSatellite(string tabId, string workspaceId, object window)
    {
        if (FindTab(tabId) is { } tab) tab.Satellites[workspaceId] = window;
    }

    public object? FindSatellite(string tabId, string workspaceId) =>
        FindTab(tabId)?.Satellites.GetValueOrDefault(workspaceId);

    public void ReleaseSatellite(object window)
    {
        foreach (var tab in tabs)
            foreach (var (workspaceId, satellite) in tab.Satellites)
                if (ReferenceEquals(satellite, window))
                {
                    tab.Satellites.Remove(workspaceId);
                    return;
                }
    }

    public CloseTabOutcome? CloseTab(string tabId)
    {
        var index = tabs.FindIndex(t => t.Id == tabId);
        if (index < 0) return null;
        var tab = tabs[index];
        tabs.RemoveAt(index);

        Tab? fallback = null;
        if (tabs.Count == 0) fallback = NewTab();
        else if (activeId == tab.Id) activeId = tabs[Math.Min(index, tabs.Count - 1)].Id;

        return new CloseTabOutcome(tab.View, tab.OwnsBridge ? tab.Bridge : null, [.. tab.Satellites.Values], fallback, ActiveTab!);
    }

    public IReadOnlyList<BridgeHandle> AllBridges() => [.. tabs.Where(t => t.OwnsBridge && t.Bridge is not null).Select(t => t.Bridge!)];
}
