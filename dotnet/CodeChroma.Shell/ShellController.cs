namespace CodeChroma.Shell;

/// <summary>The open-repo flow: BridgeRegistry -> TabModel -> navigate, plus workspace tabs, branch reopen, respawn and shutdown.</summary>
public sealed class ShellController(TabModel tabs, BridgeRegistry bridges, IShellUi ui, BranchBridgeClient branches, string recentsPath, string version, Action<Action>? post = null)
{
    private readonly Action<Action> dispatch = post ?? (action => action());
    private bool shuttingDown;

    public string Version { get; } = version;

    public Tab NewTab()
    {
        var tab = tabs.NewTab();
        Changed();
        return tab;
    }

    public void SwitchTab(string tabId)
    {
        if (tabs.SetActive(tabId) is not null) Changed();
    }

    public void FocusTab(string tabId)
    {
        if (tabs.FindTab(tabId) is { } tab) SurfaceTab(tab);
    }

    public void EnsureLauncherTabActive()
    {
        if (tabs.ActiveTab is { RepoPath: null, WorkspaceId: null }) return;
        NewTab();
    }

    public TabsSnapshot Snapshot()
    {
        var infos = tabs.Tabs.Select(t => new TabInfo(t.Id, TabTitles.For(tabs, t))).ToList();
        var active = tabs.ActiveTab;
        return new TabsSnapshot(infos, active?.Id, AppInfo.WindowTitle(Version, active is null ? null : TabTitles.For(tabs, active)));
    }

    public async Task OpenRepoAsync(string repoPath, string? requestingTabId, string? workspaceId = null)
    {
        if (tabs.FindByRepoPath(repoPath) is { } existing)
        {
            SurfaceTab(existing);
            if (workspaceId is null) await ReopenOpenRepoAsync(existing, repoPath);
            return;
        }

        var requesting = requestingTabId is null ? null : tabs.FindTab(requestingTabId);
        var tab = requesting is { RepoPath: null, WorkspaceId: null } ? requesting : tabs.NewTab();
        tab.RepoPath = repoPath;
        tabs.SetActive(tab.Id);
        Changed();

        BridgeHandle handle;
        try
        {
            handle = await bridges.EnsureAsync(repoPath, line => dispatch(() => ui.ShowProgress(tab, line)));
        }
        catch (Exception e) when (e is InvalidOperationException or TimeoutException or IOException or System.ComponentModel.Win32Exception)
        {
            tab.RepoPath = null;
            ui.ShowTabError(tab, e.Message);
            return;
        }

        if (tabs.FindTab(tab.Id) is null)
        {
            await BridgeManager.StopAsync(handle.Process);
            return;
        }
        RecentRepos.Add(recentsPath, repoPath, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        tabs.AssignRepo(tab.Id, repoPath, handle);
        Watch(tab.Id, handle);
        Changed();
        ui.Navigate(tab, WorkspaceUrl(handle, workspaceId ?? "main"));
    }

    public async Task OpenWorkspaceTabAsync(string senderTabId, string workspaceId, string? label = null)
    {
        if (tabs.FindTab(senderTabId) is not { } sender) return;
        var owner = sender.OwnerTabId is null ? sender : tabs.FindTab(sender.OwnerTabId);
        if (owner is null || tabs.BridgeFor(owner) is not { } bridge) return;
        if (tabs.FindWorkspaceTab(workspaceId) is { } existing)
        {
            SurfaceTab(existing);
            return;
        }
        var tab = tabs.AddWorkspaceTab(owner.Id, workspaceId, label);
        Changed();
        ui.Navigate(tab, WorkspaceUrl(bridge, workspaceId));
        await Task.CompletedTask;
    }

    public Task CloseWorkspaceTabAsync(string workspaceId) =>
        tabs.FindWorkspaceTab(workspaceId) is { } tab ? CloseTabAsync(tab.Id) : Task.CompletedTask;

    public async Task CloseTabAsync(string tabId)
    {
        foreach (var dependant in tabs.Tabs.Where(t => t.OwnerTabId == tabId).ToList()) await CloseTabAsync(dependant.Id);
        if (tabs.CloseTab(tabId) is not { } outcome) return;
        ui.CloseView(outcome.ClosedView);
        foreach (var satellite in outcome.SatellitesToClose) ui.CloseView(satellite);
        Changed();
        if (outcome.BridgeToStop is { } bridge) await BridgeManager.StopAsync(bridge.Process);
    }

    public async Task CloseProjectAsync(string tabId)
    {
        await CloseTabAsync(tabId);
        EnsureLauncherTabActive();
    }

    public async Task ShutdownAsync()
    {
        shuttingDown = true;
        await bridges.StopAllAsync();
    }

    private static string WorkspaceUrl(BridgeHandle bridge, string workspaceId) =>
        $"{bridge.Origin}/?workspace={Uri.EscapeDataString(workspaceId)}";

    private void Changed() => ui.TabsChanged(Snapshot());

    private void SurfaceTab(Tab tab)
    {
        tabs.SetActive(tab.Id);
        Changed();
        ui.Surface(tab);
    }

    private void Watch(string tabId, BridgeHandle handle) =>
        _ = handle.Process.Exited.ContinueWith(_ => dispatch(() => _ = RecoverAsync(tabId, handle)), TaskScheduler.Default);

    private async Task RecoverAsync(string tabId, BridgeHandle dead)
    {
        if (shuttingDown || tabs.FindTab(tabId) is not { RepoPath: { } repoPath } tab || !ReferenceEquals(tab.Bridge, dead)) return;
        BridgeHandle fresh;
        try
        {
            fresh = await bridges.EnsureAsync(repoPath, line => dispatch(() => ui.ShowProgress(tab, line)));
        }
        catch (Exception e) when (e is InvalidOperationException or TimeoutException or IOException or System.ComponentModel.Win32Exception)
        {
            ui.ShowTabError(tab, e.Message);
            return;
        }
        if (shuttingDown || tabs.FindTab(tabId) is null || !ReferenceEquals(tab.Bridge, dead))
        {
            await BridgeManager.StopAsync(fresh.Process);
            return;
        }
        tabs.ReplaceBridge(tabId, fresh);
        Watch(tabId, fresh);
        ui.Navigate(tab, WorkspaceUrl(fresh, "main"));
        foreach (var dependant in tabs.Tabs.Where(t => t.OwnerTabId == tabId && t.WorkspaceId is not null))
            ui.Navigate(dependant, WorkspaceUrl(fresh, dependant.WorkspaceId!));
    }

    private async Task ReopenOpenRepoAsync(Tab owner, string repoPath)
    {
        if (tabs.BridgeFor(owner) is not { } bridge) return;
        BranchChoices choices;
        try
        {
            choices = await branches.FetchChoicesAsync(bridge.Origin);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            return;
        }

        var pick = await ui.PickBranchAsync(TabTitles.Folder(repoPath), choices);
        if (pick is BranchPick.Cancel) return;
        var request = pick switch
        {
            BranchPick.Existing e => (BranchRequest)new BranchRequest.Existing(e.Name),
            BranchPick.New n => new BranchRequest.Create(n.Name, n.From),
            _ => throw new ArgumentOutOfRangeException(nameof(pick)),
        };
        switch (await branches.RequestWorkspaceAsync(bridge.Origin, request))
        {
            case BranchOutcome.Held held:
                SurfaceTab(held.Workspace is not null && tabs.FindWorkspaceTab(held.Workspace) is { } tab ? tab : owner);
                break;
            case BranchOutcome.Failed failed:
                ui.ShowError("Could not open the branch", failed.Message);
                break;
            case BranchOutcome.Opened opened:
                await OpenWorkspaceTabAsync(owner.Id, opened.Record.Id, opened.Record.Branch);
                break;
        }
    }
}
