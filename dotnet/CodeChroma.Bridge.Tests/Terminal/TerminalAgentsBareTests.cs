using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Terminal;

namespace CodeChroma.Bridge.Tests.Terminal;

public sealed class TerminalAgentsBareTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "cc-agents-" + Guid.NewGuid().ToString("N")[..8]);
    private readonly TerminalAgents _agents;

    public TerminalAgentsBareTests()
    {
        var paths = UserPaths.Under(_dir);
        var providers = new ProviderStore(paths);
        _agents = new TerminalAgents(paths, providers, new CallSiteStore(paths, providers));
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { }
    }

    [Fact]
    public void A_bare_window_gets_the_prompt_first_and_no_plugin_or_ambient_context()
    {
        var argv = _agents.Resolve("claude", null, "draw it", bare: true)!.Argv;

        Assert.Equal("draw it", argv[1]);
        Assert.DoesNotContain("--plugin-dir", argv);
        Assert.Contains("--strict-mcp-config", argv);
        Assert.Contains("--disable-slash-commands", argv);
        Assert.DoesNotContain("--no-session-persistence", argv);
    }

    [Fact]
    public void A_bare_window_carries_no_hook_settings()
    {
        var argv = _agents.Resolve("claude", null, "draw it", bare: true)!.Argv;

        Assert.DoesNotContain("--settings", argv);
    }

    [Fact]
    public void A_bare_window_with_a_visible_prompt_hides_the_skill_in_the_system_prompt()
    {
        var argv = _agents.Resolve("claude", null, "LONG SKILL TEXT", bare: true, visiblePrompt: "Help me draw")!.Argv;

        Assert.Equal("Help me draw", argv[1]);
        Assert.Equal("LONG SKILL TEXT", argv[argv.ToList().IndexOf("--system-prompt") + 1]);
    }

    [Fact]
    public void Only_a_kind_with_a_system_prompt_can_hide_the_skill()
    {
        Assert.True(_agents.SplitsSystemPrompt("claude"));
        Assert.False(_agents.SplitsSystemPrompt("shell"));
    }

    [Fact]
    public void A_normal_window_keeps_its_arguments()
    {
        var argv = _agents.Resolve("claude", null, "draw it")!.Argv;

        Assert.DoesNotContain("--strict-mcp-config", argv);
        Assert.Equal("draw it", argv[^1]);
    }

    [Fact]
    public void Resuming_a_bare_window_is_a_plain_resume()
    {
        var argv = _agents.Resolve("claude", "session-1", null, bare: true)!.Argv;

        Assert.Equal(["--resume", "session-1"], argv.Skip(argv.Count - 2));
        Assert.DoesNotContain("--strict-mcp-config", argv);
    }
}
