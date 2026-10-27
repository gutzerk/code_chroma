using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests;

public class RealBridgeEndToEndTests
{
    private static string FakeBridgeExe => Path.Combine(AppContext.BaseDirectory, OperatingSystem.IsWindows() ? "CodeChroma.Shell.FakeBridge.exe" : "CodeChroma.Shell.FakeBridge");

    private static BridgeRegistry Registry() =>
        new(new BridgeManager(new ProcessBridgeLauncher(), new TcpPortFinder(), new HttpHealthProbe(new HttpClient())), FakeBridgeExe);

    private static async Task<string> GetAsync(string url)
    {
        using var http = new HttpClient();
        return await http.GetStringAsync(url);
    }

    [Fact]
    public async Task A_real_process_gets_a_free_port_and_answers_after_the_ready_handshake()
    {
        var registry = Registry();
        var lines = new List<string>();

        var handle = await registry.EnsureAsync(Path.GetTempPath(), lines.Add);

        try
        {
            Assert.Contains(lines, l => l.Contains("bridge ready at"));
            Assert.Equal($"http://127.0.0.1:{handle.Port}", handle.Origin);
            Assert.Equal("ok", await GetAsync($"{handle.Origin}/health"));
        }
        finally { await registry.StopAllAsync(); }
    }

    [Fact]
    public async Task A_killed_bridge_is_respawned_on_the_same_port_for_that_repo_only()
    {
        var registry = Registry();
        using var a = new TempDir();
        using var b = new TempDir();
        var first = await registry.EnsureAsync(a.Path);
        var other = await registry.EnsureAsync(b.Path);

        try
        {
            await BridgeManager.StopAsync(first.Process);
            var again = await registry.EnsureAsync(a.Path);

            Assert.Equal(first.Port, again.Port);
            Assert.Same(other, await registry.EnsureAsync(b.Path));
            Assert.Equal("ok", await GetAsync($"{again.Origin}/health"));
        }
        finally { await registry.StopAllAsync(); }
    }

    [Fact]
    public async Task The_controller_opens_a_repo_on_a_real_bridge_and_a_pr_tab_reuses_it()
    {
        var registry = Registry();
        using var data = new TempDir();
        using var repo = new TempDir();
        var ui = new FakeShellUi();
        var tabs = new TabModel(() => new object());
        var controller = new ShellController(tabs, registry, ui, RecentRepos.StorePath(data.Path), "0.12.1");
        controller.NewTab();

        try
        {
            await controller.OpenRepoAsync(repo.Path, tabs.ActiveTab!.Id);
            await controller.OpenWorkspaceTabAsync(tabs.ActiveTab!.Id, "pr-7");

            var origin = tabs.Tabs[0].Bridge!.Origin;
            Assert.Equal([$"{origin}/", $"{origin}/?workspace=pr-7"], ui.Navigations.Select(n => n.Url));
            Assert.Contains(Path.GetFileName(repo.Path), await GetAsync($"{origin}/"));
        }
        finally { await controller.ShutdownAsync(); }
    }
}
