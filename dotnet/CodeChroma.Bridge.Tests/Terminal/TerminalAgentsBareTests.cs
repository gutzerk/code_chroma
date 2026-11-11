using System.Text.Json.Nodes;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Terminal;

namespace CodeChroma.Bridge.Tests.Terminal;

public sealed class TerminalAgentsBareTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "cc-agents-" + Guid.NewGuid().ToString("N")[..8]);
    private readonly TerminalAgents _agents;
    private readonly ProviderStore _providers;
    private readonly CallSiteStore _callSites;
    private readonly UserPaths _paths;

    public TerminalAgentsBareTests()
    {
        _paths = UserPaths.Under(_dir);
        _providers = new ProviderStore(_paths);
        _callSites = new CallSiteStore(_paths, _providers);
        _agents = new TerminalAgents(_paths, _providers, _callSites);
    }

    [Fact]
    public void An_agent_window_launches_the_model_assigned_to_the_agents_group()
    {
        var provider = _providers.Create(new JsonObject { ["label"] = "Claude", ["kind"] = "cli", ["adapter"] = "claude" });
        _callSites.SaveGroup("agents", new JsonObject { ["provider_id"] = (string)provider["id"]!, ["model"] = "opus" });

        var argv = _agents.Resolve("agent")!.Argv;

        Assert.Equal(["claude", "--model", "opus"], argv.Take(3));
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

    [Fact]
    public void A_drawing_window_is_a_normal_launch_with_the_drawer_subagent_and_the_lead_instruction()
    {
        var argv = _agents.Resolve("claude", null, "draw the save flow", delegation: new DrawDelegation("LEAD TEXT", "START TEXT", "DRAWER TEXT", "Read,Bash(curl -s http://b/:*)"))!.Argv.ToList();

        var drawer = File.ReadAllText(Path.Combine(argv[argv.IndexOf("--plugin-dir") + 1], "agents", BareSkill.DrawerAgent + ".md"));
        Assert.EndsWith("DRAWER TEXT", drawer);
        Assert.Contains("tools: Bash, Read", drawer);
        Assert.Equal("Read,Bash(curl -s http://b/:*)", argv[argv.IndexOf("--allowedTools") + 1]);
        Assert.EndsWith("LEAD TEXT\nSTART TEXT", argv[argv.IndexOf("--append-system-prompt") + 1]);
        Assert.DoesNotContain("--strict-mcp-config", argv);
        Assert.DoesNotContain("--system-prompt", argv);
        Assert.Equal("draw the save flow", argv[^1]);
    }

    [Fact]
    public void Resuming_a_drawing_window_passes_the_drawer_again_without_the_start_block()
    {
        var argv = _agents.Resolve("claude", "session-1", null, delegation: new DrawDelegation("LEAD", "START", "DRAWER", "Read"))!.Argv.ToList();

        Assert.Contains(argv, arg => File.Exists(Path.Combine(arg, "agents", BareSkill.DrawerAgent + ".md")));
        Assert.Equal("LEAD", argv[argv.IndexOf("--append-system-prompt") + 1]);
        Assert.Equal(["--resume", "session-1"], argv.Skip(argv.Count - 2));
    }

    [Fact]
    public void A_window_that_no_longer_runs_claude_ignores_a_stored_delegation()
    {
        JsonFile.Write(_paths.Assistant, new JsonObject { ["cli"] = "/opt/stand-in" });

        var argv = _agents.Resolve("claude", "session-1", null, delegation: new DrawDelegation("LEAD", "START", "DRAWER", "Read"))!.Argv;

        Assert.DoesNotContain("--allowedTools", argv);
        Assert.DoesNotContain("--append-system-prompt", argv);
        Assert.False(_agents.Delegates("claude"));
    }

    [Fact]
    public void Only_a_real_claude_window_delegates_drawing()
    {
        Assert.True(_agents.Delegates("claude"));
        Assert.False(_agents.Delegates("shell"));
    }
}
