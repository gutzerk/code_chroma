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

        updates = new UpdateHost(this, UserDataDir, version, () => tabs.Tabs.Select(t => (TabView)t.View), Close);
        Opened += (_, _) => updates.Start();
        MoreButton.Flyout = BuildMoreMenu();
        KeyDown += OnKeyDown;
        Closing += OnClosing;

        controller.NewTab();
        WindowState = WindowState.Maximized;
        if (AppPaths.RepoFromArgs(args) is { } repo) Opened += async (_, _) => await controller.OpenRepoAsync(Path.GetFullPath(repo), tabs.ActiveTab?.Id);
    }

    private MenuFlyout BuildMoreMenu()
    {
        MenuItem Item(string header, string? gesture, Func<Task> action)
        {
            var item = new MenuItem { Header = header, InputGesture = gesture is null ? null : KeyGesture.Parse(gesture) };
            item.Click += async (_, _) => await action();
            return item;
        }
        var flyout = new MenuFlyout();
        flyout.Items.Add(Item("Open Repo…", "Ctrl+O", () => { controller.EnsureLauncherTabActive(); return Task.CompletedTask; }));
        flyout.Items.Add(Item("New Tab", "Ctrl+T", () => { controller.NewTab(); return Task.CompletedTask; }));
        flyout.Items.Add(Item("Close Tab", "Ctrl+W", async () => { if (tabs.ActiveTab is { } active) await controller.CloseTabAsync(active.Id); }));
        flyout.Items.Add(new Separator());
        flyout.Items.Add(Item("Check for Updates…", null, () => updates.CheckManuallyAsync()));
        flyout.Items.Add(Item("About CodeChroma", null, () => Dialogs.ShowAboutAsync(this, version)));
        return flyout;
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
            var title = new TextBlock { Text = info.Title, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, Foreground = new SolidColorBrush(Color.Parse(active ? "#e6e9f0" : "#8b93a7")) };
            var close = new Button { Content = "×", Classes = { "tiny" }, Padding = new Thickness(4, 0), FontSize = 13, VerticalAlignment = VerticalAlignment.Center };
            close.Click += async (_, _) => await controller.CloseTabAsync(id);
            var body = new DockPanel { MinWidth = 110, MaxWidth = 220, Margin = new Thickness(16, 0, 8, 0) };
            DockPanel.SetDock(close, Dock.Right);
            body.Children.Add(close);
            body.Children.Add(title);
            var tab = new Border
            {
                Child = body,
                Background = new SolidColorBrush(Color.Parse(active ? "#11131a" : "#242833")),
                BorderThickness = new Thickness(0),
                CornerRadius = new CornerRadius(12, 12, 0, 0),
                Margin = new Thickness(4, 6, 0, 0),
                Cursor = new Cursor(StandardCursorType.Hand),
            };
            tab.PointerPressed += (_, _) => controller.SwitchTab(id);
            TabStrip.Children.Add(tab);
        }
        var add = new Button { Content = "+", Classes = { "tiny" }, Width = 32, FontSize = 16, VerticalAlignment = VerticalAlignment.Center, HorizontalContentAlignment = HorizontalAlignment.Center };
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
