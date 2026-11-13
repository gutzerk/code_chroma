using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Platform.Storage;
using Avalonia.Threading;

namespace CodeChroma.Shell.App;

/// <summary>The window: menu, tab strip over TabModel, one TabView (WebView + launcher) per tab; all logic lives in ShellController.</summary>
public sealed partial class MainWindow : Window, IShellUi, ILauncherHost
{
    private readonly ShellController controller;
    private readonly TabModel tabs;
    private readonly string version;
    private readonly UpdateHost updates;
    private readonly AgentPopover popover;
    private readonly Dictionary<string, TabChip> chips = [];
    private DateTime lastCycle;
    private bool shutDown;

    public MainWindow() : this([])
    {
    }

    public MainWindow(string[] args)
    {
        InitializeComponent();
        version = AppPaths.DisplayVersion(Environment.GetEnvironmentVariable("CODECHROMA_VERSION")
            ?? Assembly.GetEntryAssembly()?.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion);
        UserDataDir = AppPaths.CurrentUserDataDir();
        Directory.CreateDirectory(UserDataDir);
        RecentsPath = RecentRepos.StorePath(UserDataDir);
        tabs = new TabModel(CreateView);
        var manager = new BridgeManager(new ProcessBridgeLauncher(), new TcpPortFinder(), new HttpHealthProbe(new HttpClient()));
        controller = new ShellController(tabs, new BridgeRegistry(manager, ResolveBridge()), this, RecentsPath, version, action => Dispatcher.UIThread.Post(action), TabSession.StorePath(UserDataDir));

        updates = new UpdateHost(this, UserDataDir, version, () => tabs.Tabs.Select(t => (TabView)t.View).Where(v => IsBridgeOrigin(v, v.Web.Url)), Close);
        Opened += (_, _) => updates.Start();
        if (OperatingSystem.IsMacOS())
        {
            NativeMenu.SetMenu(this, BuildNativeMenu());
            MoreButton.IsVisible = false;
        }
        else MoreButton.Flyout = BuildMoreMenu();
        popover = new AgentPopover(TabPopover, controller);
        WaitingKey.Text = OperatingSystem.IsMacOS() ? "⌘⇧J" : "Ctrl+Shift+J";
        WaitingPill.Click += (_, _) => CycleWaiting();
        Deactivated += (_, _) => popover.Close();
        KeyDown += OnKeyDown;
        Closing += OnClosing;

        controller.NewTab();
        WindowState = WindowState.Maximized;
        var repo = AppPaths.RepoFromArgs(args);
        Opened += async (_, _) =>
        {
            var restore = controller.RestoreSessionAsync();
            if (repo is not null) await controller.OpenRepoAsync(Path.GetFullPath(repo), tabs.ActiveTab?.Id);
            await restore;
        };
    }

    /// <summary>The one command list: a flyout behind "…" on Windows/Linux, the native menu bar on macOS where one is expected.</summary>
    private IReadOnlyList<(string Header, string? Key, Func<Task>? Action)> Commands() =>
    [
        ("Open Repo…", "O", () => { controller.EnsureLauncherTabActive(); return Task.CompletedTask; }),
        ("New Tab", "T", () => { controller.NewTab(); return Task.CompletedTask; }),
        ("Close Tab", "W", async () => { if (tabs.ActiveTab is { } active) await controller.CloseTabAsync(active.Id); }),
        ("Next Waiting Agent", "Shift+J", () => { CycleWaiting(); return Task.CompletedTask; }),
        ("-", null, null),
        ("Check for Updates…", null, () => updates.CheckManuallyAsync()),
        ("About CodeChroma", null, () => Dialogs.ShowAboutAsync(this, version)),
    ];

    private static KeyGesture? Gesture(string? key) =>
        key is null ? null : KeyGesture.Parse($"{(OperatingSystem.IsMacOS() ? "Meta" : "Ctrl")}+{key}");

    private MenuFlyout BuildMoreMenu()
    {
        var flyout = new MenuFlyout();
        foreach (var (header, key, action) in Commands())
        {
            if (action is null) { flyout.Items.Add(new Separator()); continue; }
            var item = new MenuItem { Header = header, InputGesture = Gesture(key) };
            item.Click += async (_, _) => await action();
            flyout.Items.Add(item);
        }
        return flyout;
    }

    private NativeMenu BuildNativeMenu()
    {
        var root = new NativeMenu();
        var file = new NativeMenu();
        foreach (var (header, key, action) in Commands())
        {
            if (action is null) { file.Items.Add(new NativeMenuItemSeparator()); continue; }
            var item = new NativeMenuItem { Header = header, Gesture = Gesture(key) };
            item.Click += async (_, _) => await action();
            file.Items.Add(item);
        }
        root.Items.Add(new NativeMenuItem { Header = "CodeChroma", Menu = file });
        return root;
    }

    public string UserDataDir { get; }

    public string RecentsPath { get; }

    private static string ResolveBridge()
    {
        if (Environment.GetEnvironmentVariable("CODECHROMA_BRIDGE") is { Length: > 0 } explicitPath) return explicitPath;
        var os = ShellPlatform.Current.Os;
        var baseDir = AppContext.BaseDirectory;
        var packaged = File.Exists(Path.Combine(baseDir, "bridge", BridgeLocation.ExecutableName, os == ShellOs.Windows ? $"{BridgeLocation.ExecutableName}.exe" : BridgeLocation.ExecutableName));
        var root = new DirectoryInfo(baseDir);
        while (root is not null && !Directory.Exists(Path.Combine(root.FullName, "dist", BridgeLocation.ExecutableName))) root = root.Parent;
        try { return BridgeLocation.Resolve(packaged, baseDir, root?.FullName ?? baseDir, os); }
        catch (FileNotFoundException e) { return e.Message; }
    }

    private object CreateView()
    {
        var view = new TabView(this) { IsVisible = false };
        view.Web.NavigationCompleted += (_, _) =>
        {
            if (IsBridgeOrigin(view, view.Web.Url)) _ = view.Web.ExecuteScriptAsync(DesktopScript.Source);
        };
        view.Web.NavigationStarting += (_, e) =>
        {
            if (e.Url is not { } target) return;
            if (IsBridgeOrigin(view, target) || target.Scheme == "about")
            {
                if (!SameDocument(view.Web.Url, target) && tabs.Tabs.FirstOrDefault(t => ReferenceEquals(t.View, view)) is { } tab) controller.PageReset(tab.Id);
                return;
            }
            e.Cancel = true;
            if (target.Scheme is "http" or "https") Process.Start(new ProcessStartInfo(target.AbsoluteUri) { UseShellExecute = true });
        };
        view.Web.WebMessageReceived += (_, e) => Dispatcher.UIThread.Post(() =>
        {
            if (IsBridgeOrigin(view, view.Web.Url)) OnCanvasMessage(view, e.Message);
        });
        view.Web.WebViewNewWindowRequested += (_, e) => e.UrlLoadingStrategy = WebViewCore.Enums.UrlRequestStrategy.OpenExternally;
        Content.Children.Add(view);
        return view;
    }

    /// <summary>A fragment-only jump keeps the page (and its agent summary); anything else loads a new document.</summary>
    private static bool SameDocument(Uri? current, Uri target) =>
        current is not null && target.Fragment.Length > 0
        && Uri.Compare(current, target, UriComponents.HttpRequestUrl, UriFormat.Unescaped, StringComparison.Ordinal) == 0;

    private bool IsBridgeOrigin(TabView view, Uri? current)
    {
        var tab = tabs.Tabs.FirstOrDefault(t => ReferenceEquals(t.View, view));
        if (current is null || tab is null || tabs.BridgeFor(tab) is not { } bridge) return false;
        return Uri.TryCreate(bridge.Origin, UriKind.Absolute, out var origin)
            && current.Scheme == origin.Scheme && current.Host == origin.Host && current.Port == origin.Port;
    }

    private void OnCanvasMessage(TabView view, string? json)
    {
        if (DesktopMessage.Parse(json) is not { } message) return;
        var tab = tabs.Tabs.FirstOrDefault(t => ReferenceEquals(t.View, view));
        if (tab is null) return;
        switch (message.Type)
        {
            case "open-workspace" when message.Id is not null: _ = controller.OpenWorkspaceTabAsync(tab.Id, message.Id); break;
            case "close-workspace" when message.Id is not null: _ = controller.CloseWorkspaceTabAsync(message.Id); break;
            case "updates": _ = updates.HandleCallAsync(view, message); break;
            case "save-file": _ = SaveFileAsync(view, message); break;
            case "clipboard": _ = ClipboardAsync(view, message); break;
            case "focus-tab": controller.FocusTab(tab.Id); break;
            case "close-project": _ = controller.CloseProjectAsync(tab.Id); break;
            case "agent-summary" when message.Agents is not null: controller.ReportAgents(tab.Id, message.Agents); break;
            case "next-waiting-agent": CycleWaiting(); break;
        }
    }

    private const int MaxClipboardWrite = 4_000_000;

    private Task ClipboardAsync(TabView view, DesktopMessage message) =>
        message.CallId is null
            ? Task.CompletedTask
            : ShellReply.RunAsync(view, message.CallId, async () =>
            {
                var clipboard = Clipboard ?? throw new InvalidOperationException("Clipboard unavailable");
                if (!IsActive || !view.IsVisible) throw new InvalidOperationException("Clipboard is only available to the focused tab");
                if (message.Method == "read") return JsonSerializer.Serialize(await clipboard.GetTextAsync() ?? "");
                if (message.Method != "write" || message.Arg is null || message.Arg.Length > MaxClipboardWrite) throw new InvalidOperationException("Invalid clipboard operation");
                await clipboard.SetTextAsync(message.Arg);
                return "null";
            });

    private Task SaveFileAsync(TabView view, DesktopMessage message) =>
        message.CallId is null
            ? Task.CompletedTask
            : ShellReply.RunAsync(view, message.CallId, () => new FileSaver(new WindowSavePicker(this)).SaveAsync(message.Id, message.Method, message.Arg));

    private sealed class WindowSavePicker(Window window) : ISaveFilePicker
    {
        public async Task<string?> PickAsync(string suggestedName, string mime)
        {
            var extension = Path.GetExtension(suggestedName);
            var kind = extension.TrimStart('.');
            var options = new FilePickerSaveOptions
            {
                Title = "Export diagram",
                SuggestedFileName = suggestedName,
                DefaultExtension = kind,
                FileTypeChoices = [new FilePickerFileType(kind.ToUpperInvariant()) { Patterns = [$"*{extension}"], MimeTypes = [mime] }],
            };
            var file = await window.StorageProvider.SaveFilePickerAsync(options);
            return file?.TryGetLocalPath();
        }
    }

    private void OnKeyDown(object? sender, KeyEventArgs e)
    {
        if (!e.KeyModifiers.HasFlag(KeyModifiers.Control) && !e.KeyModifiers.HasFlag(KeyModifiers.Meta)) return;
        var command = OperatingSystem.IsMacOS() ? KeyModifiers.Meta : KeyModifiers.Control;
        switch (e.Key)
        {
            case Key.O: controller.EnsureLauncherTabActive(); break;
            case Key.T: controller.NewTab(); break;
            case Key.J when e.KeyModifiers.HasFlag(KeyModifiers.Shift) && e.KeyModifiers.HasFlag(command): CycleWaiting(); break;
            case Key.W when tabs.ActiveTab is { } active: _ = controller.CloseTabAsync(active.Id); break;
            default: return;
        }
        e.Handled = true;
    }

    private async void OnClosing(object? sender, WindowClosingEventArgs e)
    {
        if (shutDown) return;
        e.Cancel = true;
        await controller.ShutdownAsync();
        foreach (var tab in tabs.Tabs) MacWebViewChannel.Detach(((TabView)tab.View).Web);
        shutDown = true;
        Close();
    }

    /// <summary>The pill, ⌘⇧J, the native menu item and the page's key listener all land here; a repeat within 150 ms is one press.</summary>
    private void CycleWaiting()
    {
        var now = DateTime.UtcNow;
        if (now - lastCycle < TimeSpan.FromMilliseconds(150)) return;
        lastCycle = now;
        popover.Close();
        controller.FocusNextBlocked();
    }

    public void TabsChanged(TabsSnapshot snapshot)
    {
        Title = snapshot.WindowTitle;
        foreach (var tab in tabs.Tabs) ((TabView)tab.View).IsVisible = tab.Id == snapshot.ActiveId;
        foreach (var gone in chips.Keys.Except(snapshot.Tabs.Select(t => t.Id)).ToList()) chips.Remove(gone);
        var ordered = new List<Control>();
        foreach (var info in snapshot.Tabs)
        {
            if (!chips.TryGetValue(info.Id, out var chip))
            {
                chip = new TabChip(info.Id, controller.SwitchTab, controller.CloseTabAsync);
                var hovered = chip;
                chip.PointerEntered += (_, _) => popover.Enter(hovered);
                chip.PointerExited += (_, _) => popover.Leave();
                chip.GotFocus += (_, e) => { if (e.NavigationMethod == NavigationMethod.Tab) popover.Enter(hovered); };
                chip.LostFocus += (_, _) => popover.Leave();
                chip.KeyDown += (_, e) => { if (e.Key == Key.Down) e.Handled = popover.OpenFromKeyboard(hovered); };
                chips[info.Id] = chip;
            }
            chip.Update(info, info.Id == snapshot.ActiveId);
            ordered.Add(chip);
        }
        if (TabStrip.Children.Count != ordered.Count + 1 || !TabStrip.Children.Take(ordered.Count).SequenceEqual(ordered))
        {
            TabStrip.Children.Clear();
            TabStrip.Children.AddRange(ordered);
            var add = new Button { Content = "+", Classes = { "tiny" }, Width = 32, Height = 32, FontSize = 16, VerticalAlignment = VerticalAlignment.Bottom, HorizontalContentAlignment = HorizontalAlignment.Center, VerticalContentAlignment = VerticalAlignment.Center };
            add.Click += (_, _) => controller.NewTab();
            TabStrip.Children.Add(add);
        }
        WaitingPill.IsVisible = snapshot.Waiting > 0;
        WaitingText.Text = $"{snapshot.Waiting} waiting";
        AutomationProperties.SetName(WaitingPill, $"{snapshot.Waiting} {AgentRollup.Plural(snapshot.Waiting, "agent", "agents")} waiting");
        popover.Refresh(chips);
    }

    public void AgentsChanged(string tabId, AgentSummary summary)
    {
        if (!chips.TryGetValue(tabId, out var chip)) return;
        chip.SetAgents(summary);
        popover.Refresh(chips);
    }

    public void SendAgentCommand(Tab tab, string json)
    {
        var view = (TabView)tab.View;
        if (!IsBridgeOrigin(view, view.Web.Url)) return;
        _ = view.Web.ExecuteScriptAsync($"window.__ccAgentCommand && window.__ccAgentCommand({JsonSerializer.Serialize(json)});");
    }

    public void Navigate(Tab tab, string url) => ((TabView)tab.View).Navigate(url);

    public void ShowProgress(Tab tab, string line) => ((TabView)tab.View).Launcher.ShowProgress(line);

    public void ShowTabError(Tab tab, string message) => ((TabView)tab.View).Launcher.ShowError(message);

    public void Surface(Tab tab)
    {
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
    }

    public void CloseView(object view)
    {
        if (view is not TabView tabView) return;
        MacWebViewChannel.Detach(tabView.Web);
        Content.Children.Remove(tabView);
        tabView.Web.Url = null;
    }

    public void ShowError(string title, string message) => _ = Dialogs.ShowMessageAsync(this, title, message);

    public Task OpenRepoAsync(LauncherPanel requester, string repoPath, string? workspaceId)
    {
        var tab = tabs.Tabs.FirstOrDefault(t => ReferenceEquals(((TabView)t.View).Launcher, requester));
        return tab is null ? Task.CompletedTask : controller.OpenRepoAsync(repoPath, tab.Id, workspaceId);
    }

    public async Task<string?> PickFolderAsync(string title)
    {
        var folders = await StorageProvider.OpenFolderPickerAsync(new FolderPickerOpenOptions { Title = title, AllowMultiple = false });
        return folders.Count == 0 ? null : folders[0].TryGetLocalPath();
    }
}
