using System.Text.Json;
using Avalonia.Controls;
using Avalonia.Threading;

namespace CodeChroma.Shell.App;

/// <summary>Owns the update lifecycle for the window: the scheduled checks, the page bridge and the menu flow.</summary>
public sealed class UpdateHost
{
    private readonly Window window;
    private readonly Func<IEnumerable<TabView>> views;
    private readonly UpdateScheduler scheduler;
    private readonly UpdateService service;
    private readonly UpdatesBridge bridge;
    private readonly string settingsPath;

    public UpdateHost(Window window, string userDataDir, string version, Func<IEnumerable<TabView>> views, Action quit)
    {
        this.window = window;
        this.views = views;
        settingsPath = UpdateSettingsStore.PathIn(userDataDir);
        var location = InstallLocation.Current();
        scheduler = new UpdateScheduler(() => DateTimeOffset.UtcNow, location.IsUserInstallation());
        var http = new HttpClient();
        http.DefaultRequestHeaders.UserAgent.ParseAdd(UpdateConstants.UserAgent);
        var platform = ShellPlatform.Current;
        var operations = new UpdateOperations(
            new UpdateChecker(http), new UpdateDownloader(http, new ChecksumOnlyAttestationVerifier()),
            new PlatformInstaller(location, platform, userDataDir, new ProcessHelperLauncher()), location, platform);
        UpdatesBridge? self = null;
        service = new UpdateService(version, operations, new FileUpdateCache(FileUpdateCache.PathIn(userDataDir)), _ => self?.Push(),
            readOutcome: () => InstallOutcomeStore.Read(userDataDir), acknowledgeOutcome: () => InstallOutcomeStore.Acknowledge(userDataDir));
        bridge = self = new UpdatesBridge(service, () => UpdateSettingsStore.Read(settingsPath), s => UpdateSettingsStore.Write(settingsPath, s),
            exit => { if (exit) quit(); }, json => Dispatcher.UIThread.Post(() => PushToPages(json)));
    }

    /// <summary>Reports a finished install, then starts the periodic checks.</summary>
    public void Start()
    {
        _ = ReportLastInstallAsync();
        _ = BackgroundCheckAsync(CheckTrigger.Startup);
        var timer = new DispatcherTimer { Interval = UpdateConstants.PeriodicCheck };
        timer.Tick += (_, _) => _ = BackgroundCheckAsync(CheckTrigger.Periodic);
        timer.Start();
        window.Activated += (_, _) => _ = BackgroundCheckAsync(CheckTrigger.Focus);
    }

    public async Task HandleCallAsync(TabView view, DesktopMessage message)
    {
        if (message.CallId is null || message.Method is null) return;
        string reply;
        bool ok;
        try
        {
            reply = await bridge.InvokeAsync(message.Method, message.Arg);
            ok = true;
        }
        catch (Exception e)
        {
            reply = e.Message;
            ok = false;
        }
        var script = $"window.__ccUpdatesReply({JsonSerializer.Serialize(message.CallId)},{(ok ? "true" : "false")},{JsonSerializer.Serialize(reply)});";
        await view.Web.ExecuteScriptAsync(script);
    }

    /// <summary>Help, Check for Updates: always answers, and offers the download with the checksum-only warning.</summary>
    public async Task CheckManuallyAsync()
    {
        var state = await service.CheckAsync();
        if (state.Phase == UpdatePhase.Available)
        {
            var choice = await Dialogs.ShowUpdateAsync(window, state.LatestVersion ?? "", state.VerificationNotice, state.Notes);
            if (choice == Dialogs.UpdateChoice.Skip && state.LatestVersion is not null)
                UpdateSettingsStore.Write(settingsPath, UpdateSettingsStore.Read(settingsPath) with { SkippedVersion = state.LatestVersion });
            if (choice != Dialogs.UpdateChoice.Install) return;
            using (Dialogs.ShowProgress(window, "Updating CodeChroma", $"Downloading CodeChroma {state.LatestVersion}..."))
                state = await service.DownloadAsync();
        }
        if (state.Phase == UpdatePhase.Ready)
        {
            if (await Dialogs.ConfirmAsync(window, "Update ready", "Restart to finish the update?", state.VerificationNotice ?? "", "Restart and Update", "Later"))
                state = await service.RestartAsync(exit => { if (exit) window.Close(); });
        }
        if (state.Phase == UpdatePhase.UpToDate) await Dialogs.ShowMessageAsync(window, "Check for Updates", "CodeChroma is up to date", $"Version {state.CurrentVersion}");
        else if (state.Phase == UpdatePhase.Error) await Dialogs.ShowMessageAsync(window, "Update failed", state.Error ?? "Unknown error");
    }

    private async Task BackgroundCheckAsync(CheckTrigger trigger)
    {
        if (!scheduler.ShouldCheck(trigger)) return;
        scheduler.RecordCheck();
        var state = await service.CheckAsync();
        var settings = UpdateSettingsStore.Read(settingsPath);
        if (state.Phase != UpdatePhase.Available || state.LatestVersion is null || !scheduler.ShouldNotify(state.LatestVersion, settings, trigger)) return;
        if (settings.AutoDownload) await service.DownloadAsync();
        else await Dispatcher.UIThread.InvokeAsync(CheckManuallyAsync);
    }

    private async Task ReportLastInstallAsync()
    {
        if (service.State.LastInstall is not { } outcome) return;
        await Dispatcher.UIThread.InvokeAsync(() => Dialogs.ShowInstallResultAsync(window, outcome.Version, outcome.Result, outcome.Detail));
        service.DismissLastInstall();
    }

    private void PushToPages(string json)
    {
        var script = $"window.__ccUpdatesPush && window.__ccUpdatesPush({JsonSerializer.Serialize(json)});";
        foreach (var view in views()) _ = view.Web.ExecuteScriptAsync(script);
    }
}
