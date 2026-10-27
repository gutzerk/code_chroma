namespace CodeChroma.Shell.Tests.Support;

internal sealed class FakeShellUi : IShellUi
{
    public List<TabsSnapshot> Snapshots { get; } = [];
    public List<(Tab Tab, string Url)> Navigations { get; } = [];
    public List<(Tab Tab, string Line)> Progress { get; } = [];
    public List<(Tab Tab, string Message)> TabErrors { get; } = [];
    public List<string> Surfaced { get; } = [];
    public List<object> ClosedViews { get; } = [];
    public List<(string Title, string Message)> Errors { get; } = [];

    public TabsSnapshot Last => Snapshots[^1];

    public void TabsChanged(TabsSnapshot snapshot) => Snapshots.Add(snapshot);
    public void Navigate(Tab tab, string url) => Navigations.Add((tab, url));
    public void ShowProgress(Tab tab, string line) => Progress.Add((tab, line));
    public void ShowTabError(Tab tab, string message) => TabErrors.Add((tab, message));
    public void Surface(Tab tab) => Surfaced.Add(tab.Id);
    public void CloseView(object view) => ClosedViews.Add(view);
    public void ShowError(string title, string message) => Errors.Add((title, message));
}

internal sealed class ShellHarness : IDisposable
{
    public const string Version = "0.12.1";

    private readonly TempDir data = new();
    public FakeLauncher Launcher { get; } = new();
    public FakeShellUi Ui { get; } = new();
    public TabModel Tabs { get; } = new(() => new object());
    public ShellController Controller { get; }
    public string RecentsPath => RecentRepos.StorePath(data.Path);

    public ShellHarness(bool startWithEmptyTab = true)
    {
        Launcher.OnStart = p => p.Say($"[codechroma-live] bridge ready at http://127.0.0.1:{p.Spec.Port}");
        var manager = new BridgeManager(Launcher, new SequencePorts(), new ScriptedHealth(_ => false), TimeSpan.FromMilliseconds(5));
        Controller = new ShellController(Tabs, new BridgeRegistry(manager, "bridge.exe"), Ui, RecentsPath, Version);
        if (startWithEmptyTab) Controller.NewTab();
    }

    public static async Task Eventually(Func<bool> condition, int milliseconds = 5000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(milliseconds);
        while (!condition())
        {
            if (DateTime.UtcNow > deadline) throw new TimeoutException("condition never became true");
            await Task.Delay(10);
        }
    }

    public void Dispose() => data.Dispose();
}
