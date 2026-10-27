using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
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
        controller = new ShellController(tabs, new BridgeRegistry(manager, ResolveBridge()), this, RecentsPath, version, action => Dispatcher.UIThread.Post(action));

        updates = new UpdateHost(this, UserDataDir, version, () => tabs.Tabs.Select(t => (TabView)t.View).Where(v => IsBridgeOrigin(v, v.Web.Url)), Close);
        Opened += (_, _) => updates.Start();
        if (OperatingSystem.IsMacOS())
        {
            NativeMenu.SetMenu(this, BuildNativeMenu());
            MoreButton.IsVisible = false;
        }
        else MoreButton.Flyout = BuildMoreMenu();
        KeyDown += OnKeyDown;
        Closing += OnClosing;

        controller.NewTab();
        WindowState = WindowState.Maximized;
        if (AppPaths.RepoFromArgs(args) is { } repo) Opened += async (_, _) => await controller.OpenRepoAsync(Path.GetFullPath(repo), tabs.ActiveTab?.Id);
    }

    /// <summary>The one command list: a flyout behind "…" on Windows/Linux, the native menu bar on macOS where one is expected.</summary>
    private IReadOnlyList<(string Header, string? Key, Func<Task>? Action)> Commands() =>
    [
        ("Open Repo…", "O", () => { controller.EnsureLauncherTabActive(); return Task.CompletedTask; }),
        ("New Tab", "T", () => { controller.NewTab(); return Task.CompletedTask; }),
        ("Close Tab", "W", async () => { if (tabs.ActiveTab is { } active) await controller.CloseTabAsync(active.Id); }),
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
            if (e.Url is not { } target || IsBridgeOrigin(view, target) || target.Scheme == "about") return;
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
