using System.Diagnostics;
using System.Reflection;
using Avalonia;
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
        controller = new ShellController(tabs, new BridgeRegistry(manager, ResolveBridge()), this, new BranchBridgeClient(new HttpClient()), RecentsPath, version, action => Dispatcher.UIThread.Post(action));

        OpenRepoItem.Click += (_, _) => controller.EnsureLauncherTabActive();
        NewTabItem.Click += (_, _) => controller.NewTab();
        CloseTabItem.Click += async (_, _) => { if (tabs.ActiveTab is { } active) await controller.CloseTabAsync(active.Id); };
        updates = new UpdateHost(this, UserDataDir, version, () => tabs.Tabs.Select(t => (TabView)t.View), Close);
        CheckUpdatesItem.Click += async (_, _) => await updates.CheckManuallyAsync();
        Opened += (_, _) => updates.Start();
        AboutItem.Click += async (_, _) => await Dialogs.ShowAboutAsync(this, version);
        KeyDown += OnKeyDown;
        Closing += OnClosing;

        controller.NewTab();
        WindowState = WindowState.Maximized;
        if (AppPaths.RepoFromArgs(args) is { } repo) Opened += async (_, _) => await controller.OpenRepoAsync(Path.GetFullPath(repo), tabs.ActiveTab?.Id);
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
        view.Web.NavigationCompleted += (_, _) => _ = view.Web.ExecuteScriptAsync(DesktopScript.Source);
        view.Web.WebMessageReceived += (_, e) => Dispatcher.UIThread.Post(() => OnCanvasMessage(view, e.Message));
        view.Web.WebViewNewWindowRequested += (_, e) => e.UrlLoadingStrategy = WebViewCore.Enums.UrlRequestStrategy.OpenExternally;
        Content.Children.Add(view);
        return view;
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
            case "focus-tab": controller.FocusTab(tab.Id); break;
            case "close-project": _ = controller.CloseProjectAsync(tab.Id); break;
        }
    }

    private void OnKeyDown(object? sender, KeyEventArgs e)
    {
        if (!e.KeyModifiers.HasFlag(KeyModifiers.Control) && !e.KeyModifiers.HasFlag(KeyModifiers.Meta)) return;
        switch (e.Key)
        {
            case Key.O: controller.EnsureLauncherTabActive(); break;
            case Key.T: controller.NewTab(); break;
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
        shutDown = true;
        Close();
    }

    public void TabsChanged(TabsSnapshot snapshot)
    {
        Title = snapshot.WindowTitle;
        foreach (var tab in tabs.Tabs) ((TabView)tab.View).IsVisible = tab.Id == snapshot.ActiveId;
        TabStrip.Children.Clear();
        foreach (var info in snapshot.Tabs)
        {
            var id = info.Id;
            var active = id == snapshot.ActiveId;
            var select = new Button { Content = info.Title, FontWeight = active ? FontWeight.SemiBold : FontWeight.Normal, Padding = new Thickness(10, 4), BorderThickness = new Thickness(0, 0, 0, active ? 2 : 0), BorderBrush = new SolidColorBrush(Color.Parse("#6c8cff")) };
            select.Click += (_, _) => controller.SwitchTab(id);
            var close = new Button { Content = "×", Padding = new Thickness(6, 2), Background = Brushes.Transparent };
            close.Click += async (_, _) => await controller.CloseTabAsync(id);
            TabStrip.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Children = { select, close } });
        }
        var add = new Button { Content = "+" };
        add.Click += (_, _) => controller.NewTab();
        TabStrip.Children.Add(add);
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
        Content.Children.Remove(tabView);
        tabView.Web.Url = null;
    }

    public void ShowError(string title, string message) => _ = Dialogs.ShowMessageAsync(this, title, message);

    public Task<BranchPick> PickBranchAsync(string project, BranchChoices choices) => Dialogs.PickBranchAsync(this, project, choices);

    public Task OpenRepoAsync(string repoPath, string? workspaceId) =>
        controller.OpenRepoAsync(repoPath, tabs.ActiveTab?.Id, workspaceId);

    public async Task<string?> PickFolderAsync(string title)
    {
        var folders = await StorageProvider.OpenFolderPickerAsync(new FolderPickerOpenOptions { Title = title, AllowMultiple = false });
        return folders.Count == 0 ? null : folders[0].TryGetLocalPath();
    }
}
