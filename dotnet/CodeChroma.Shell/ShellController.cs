namespace CodeChroma.Shell;

/// <summary>The open-repo flow: BridgeRegistry -> TabModel -> navigate, plus PR workspace tabs, respawn and shutdown.</summary>
public sealed class ShellController(TabModel tabs, BridgeRegistry bridges, IShellUi ui, string recentsPath, string version, Action<Action>? post = null, string? sessionPath = null)
{
    private readonly Action<Action> dispatch = post ?? (action => action());
    private readonly AgentBoard agents = new();
    private bool shuttingDown;
    private bool restoring;
    private string? savedSession;
    private readonly Dictionary<string, IReadOnlyList<SessionTab>> unopened = [];

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
        var infos = tabs.Tabs.Select(t => new TabInfo(t.Id, TabTitles.For(tabs, t), agents.For(t.Id))).ToList();
        var active = tabs.ActiveTab;
        return new TabsSnapshot(infos, active?.Id, AppInfo.WindowTitle(Version, active is null ? null : TabTitles.For(tabs, active)), agents.Blocked(Order()).Count);
    }

    public void ReportAgents(string tabId, AgentSummary summary)
    {
        if (tabs.FindTab(tabId) is null) return;
        switch (agents.Report(tabId, summary))
        {
            case AgentChange.Tabs: Redraw(); break;
            case AgentChange.Activity: ui.AgentsChanged(tabId, summary); break;
        }
    }

    /// <summary>The tab's page is gone or reloading: drop its summary so the pill and badges stop pointing at it.</summary>
    public void PageReset(string tabId) => ForgetAgents([tabId]);

    private void ForgetAgents(IEnumerable<string> tabIds)
    {
        if (tabIds.Count(agents.Forget) > 0) Redraw();
    }

    public BlockedAgent? FocusNextBlocked()
    {
        if (agents.Next(Order()) is not { } next) return null;
        OpenAgent(next.TabId, next.Agent.Id);
        return next;
    }

    public void OpenAgent(string tabId, string agentId)
    {
        if (tabs.FindTab(tabId) is not { } tab) return;
        SurfaceTab(tab);
        ui.SendAgentCommand(tab, AgentCommand.Select(agentId));
    }

    public void AllowPermission(string tabId, string agentId, string requestId)
    {
        if (tabs.FindTab(tabId) is { } tab) ui.SendAgentCommand(tab, AgentCommand.Allow(agentId, requestId));
    }

    private List<(string TabId, string RootId)> Order() =>
        [.. tabs.Tabs.Select(t => (t.Id, t.OwnerTabId ?? t.Id))];

    public async Task OpenRepoAsync(string repoPath, string? requestingTabId, string? workspaceId = null)
    {
        if (tabs.FindByRepoPath(repoPath) is { } existing)
        {
            SurfaceTab(existing);
            if (workspaceId is null || tabs.BridgeFor(existing) is not { } open) return;
            ForgetAgents([existing.Id]);
            ui.Navigate(existing, WorkspaceUrl(open, workspaceId));
            return;
        }

        var requesting = requestingTabId is null ? null : tabs.FindTab(requestingTabId);
        var tab = requesting is { RepoPath: null, WorkspaceId: null } ? requesting : tabs.NewTab();
        tab.RepoPath = repoPath;
        unopened.Remove(tab.Id);
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
            ForgetAgents([tab.Id]);
            SaveSession();
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
        ui.Navigate(tab, workspaceId is null ? RepoUrl(handle) : WorkspaceUrl(handle, workspaceId));
    }

    /// <summary>Reopens the tabs saved by the last session; repo folders that no longer exist are skipped.</summary>
    public async Task RestoreSessionAsync()
    {
        if (sessionPath is null) return;
        var saved = TabSession.Read(sessionPath);
        var repos = saved.Tabs.Where(t => t.WorkspaceId is null && Directory.Exists(t.RepoPath))
            .DistinctBy(t => RepoPaths.Canonical(t.RepoPath)).Select(t => t.RepoPath).ToList();
        if (repos.Count == 0) return;
        restoring = true;
        try
        {
            var launcher = tabs.ActiveTab?.Id;
            var opens = new List<(string Repo, string? TabId, Task Open)>();
            foreach (var repo in repos)
            {
                var open = OpenRepoAsync(repo, opens.Count == 0 ? launcher : null);
                opens.Add((repo, tabs.ActiveTab?.Id, open));
            }
            if (saved.Active is { WorkspaceId: null } activeRepo && tabs.FindByRepoPath(activeRepo.RepoPath) is { } first) tabs.SetActive(first.Id);
            var expectedActive = tabs.ActiveTab?.Id;
            Changed();
            foreach (var (repo, tabId, open) in opens)
            {
                await open;
                var workspaces = saved.Tabs.Where(t => t.WorkspaceId is not null && RepoPaths.Canonical(t.RepoPath) == RepoPaths.Canonical(repo)).ToList();
                if (tabs.FindByRepoPath(repo) is not { Bridge: not null } owner)
                {
                    // A bridge that failed to start keeps its saved tabs on the error tab, so one slow launch never forgets them.
                    if (tabId is not null && tabs.FindTab(tabId) is { RepoPath: null, WorkspaceId: null }) unopened[tabId] = [new SessionTab(repo), .. workspaces];
                    continue;
                }
                foreach (var ws in workspaces)
                    expectedActive = await RestoreWorkspaceTabAsync(owner.Id, ws, ReferenceEquals(ws, saved.Active), expectedActive);
            }
        }
        finally
        {
            restoring = false;
            SaveSession();
        }
    }

    /// <summary>Reopens one saved PR tab; it takes focus only if it was the saved active tab and the user has not switched tabs since. Returns the tab restore now expects to be active.</summary>
    private async Task<string?> RestoreWorkspaceTabAsync(string ownerId, SessionTab saved, bool wasActive, string? expectedActive)
    {
        var current = tabs.ActiveTab?.Id;
        await OpenWorkspaceTabAsync(ownerId, saved.WorkspaceId!, saved.Label);
        var takeFocus = wasActive && current == expectedActive;
        if (!takeFocus && current is not null) tabs.SetActive(current);
        Changed();
        return takeFocus ? tabs.ActiveTab?.Id : expectedActive;
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
        agents.Forget(tabId);
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

    private static string RepoUrl(BridgeHandle bridge) => $"{bridge.Origin}/";

    private static string WorkspaceUrl(BridgeHandle bridge, string workspaceId) =>
        $"{bridge.Origin}/?workspace={Uri.EscapeDataString(workspaceId)}";

    private void Changed()
    {
        Redraw();
        SaveSession();
    }

    /// <summary>Repaints the strip for agent pills and badges, which the saved session does not hold.</summary>
    private void Redraw() => ui.TabsChanged(Snapshot());

    private void SaveSession()
    {
        if (sessionPath is null || restoring || shuttingDown) return;
        var json = TabSession.Serialize(TabSession.Capture(tabs, unopened));
        if (json == savedSession) return;
        try
        {
            TabSession.Write(sessionPath, json);
            savedSession = json;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
    }

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
        ForgetAgents([tabId, .. tabs.Tabs.Where(t => t.OwnerTabId == tabId).Select(t => t.Id)]);
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
        ui.Navigate(tab, RepoUrl(fresh));
        foreach (var dependant in tabs.Tabs.Where(t => t.OwnerTabId == tabId && t.WorkspaceId is not null))
            ui.Navigate(dependant, WorkspaceUrl(fresh, dependant.WorkspaceId!));
    }
}
