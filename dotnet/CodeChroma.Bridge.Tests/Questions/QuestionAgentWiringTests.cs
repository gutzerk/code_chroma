using System.Text.Json.Nodes;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Terminal;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Tests.Questions;

/// <summary>Agent wiring: MCP argv registration, env, the config file and the signed token.</summary>
public sealed class QuestionAgentWiringTests : IDisposable
{
    private const string BridgeUrl = "http://127.0.0.1:8123";
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "cc-qwire-" + Guid.NewGuid().ToString("N")[..8]);
    private readonly QuestionMcp _mcp = new(_ => throw new InvalidOperationException("no workspace in this test"));
    private readonly TerminalAgents _agents;
    private readonly ProviderStore _providers;
    private readonly CallSiteStore _callSites;

    public QuestionAgentWiringTests()
    {
        var paths = UserPaths.Under(_dir);
        _providers = new ProviderStore(paths);
        _callSites = new CallSiteStore(paths, _providers);
        _agents = new TerminalAgents(paths, _providers, _callSites, _mcp);
    }

    private string KimiMcpFile(string text)
    {
        var file = Path.Combine(_dir, "worktree", ".kimi-code", "mcp.json");
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        File.WriteAllText(file, text);
        return file;
    }

    private void UseAgentCli(string adapter)
    {
        var provider = _providers.Create(new JsonObject { ["label"] = adapter, ["kind"] = "cli", ["adapter"] = adapter });
        _callSites.SaveGroup("agents", new JsonObject { ["provider_id"] = (string)provider["id"]!, ["model"] = "m" });
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { }
    }

    [Fact]
    public void The_claude_argv_registers_the_mcp_config_before_the_plugin_dir_and_the_prompt()
    {
        var launch = _agents.Resolve("claude", initialPrompt: "do it", agentId: "agent-1", bridgeUrl: BridgeUrl)!;

        var argv = launch.Argv.ToList();
        var mcp = argv.IndexOf("--mcp-config");
        Assert.True(mcp >= 1);
        if (argv.Contains("--plugin-dir")) Assert.Equal(mcp + 2, argv.IndexOf("--plugin-dir"));
        Assert.Equal("do it", argv[^1]);
        Assert.Equal(BridgeUrl, launch.Env["CODECHROMA_BRIDGE_URL"]);
        Assert.Equal("agent-1", launch.Env["CODECHROMA_WORKSPACE_ID"]);
        Assert.Equal("agent-1", _mcp.WorkspaceIdFor(launch.Env["CODECHROMA_QUESTION_TOKEN"]));
    }

    [Fact]
    public void The_mcp_config_file_holds_an_http_server_with_a_bearer_header_and_a_short_timeout()
    {
        var launch = _agents.Resolve("claude", agentId: "agent-1", bridgeUrl: BridgeUrl)!;

        var server = JsonNode.Parse(File.ReadAllText(launch.Argv[launch.Argv.ToList().IndexOf("--mcp-config") + 1]))!["mcpServers"]!["codechroma"]!;

        Assert.Equal("http", (string?)server["type"]);
        Assert.Equal(BridgeUrl + "/mcp/", (string?)server["url"]);
        Assert.Equal("Bearer " + launch.Env["CODECHROMA_QUESTION_TOKEN"], (string?)server["headers"]!["Authorization"]);
        Assert.Equal(60_000, (int)server["timeout"]!);
    }

    [Fact]
    public void The_argv_is_unchanged_without_an_agent_id_or_a_bridge_url()
    {
        var noId = _agents.Resolve("claude", bridgeUrl: BridgeUrl)!;
        var noUrl = _agents.Resolve("claude", agentId: "agent-1")!;

        Assert.DoesNotContain("--mcp-config", noId.Argv);
        Assert.DoesNotContain("--mcp-config", noUrl.Argv);
        Assert.Empty(noId.Env);
    }

    [Fact]
    public void A_bare_window_and_a_shell_get_no_mcp_config()
    {
        var bare = _agents.Resolve("claude", initialPrompt: "x", bare: true, agentId: "agent-1", bridgeUrl: BridgeUrl)!;
        var shell = _agents.Resolve("shell", agentId: "agent-1", bridgeUrl: BridgeUrl)!;

        Assert.DoesNotContain("--mcp-config", bare.Argv);
        Assert.DoesNotContain("--mcp-config", shell.Argv);
        Assert.Empty(bare.Env);
    }

    [Fact]
    public void A_resumed_window_still_gets_a_fresh_token_config()
    {
        var launch = _agents.Resolve("claude", "session-9", agentId: "agent-1", bridgeUrl: BridgeUrl)!;

        Assert.Contains("--mcp-config", launch.Argv);
        Assert.Contains("session-9", launch.Argv);
    }

    [Fact]
    public void A_codex_window_registers_the_server_with_config_overrides_and_keeps_the_token_out_of_argv()
    {
        UseAgentCli("codex");

        var launch = _agents.Resolve("agent", initialPrompt: "do it", agentId: "agent-1", bridgeUrl: BridgeUrl)!;

        Assert.Contains($"mcp_servers.codechroma.url={BridgeUrl}/mcp/", launch.Argv);
        Assert.Contains("mcp_servers.codechroma.bearer_token_env_var=CODECHROMA_QUESTION_TOKEN", launch.Argv);
        Assert.Equal("do it", launch.Argv[^1]);
        Assert.DoesNotContain(launch.Argv, arg => arg.Contains(launch.Env["CODECHROMA_QUESTION_TOKEN"], StringComparison.Ordinal));
        Assert.Equal("agent-1", _mcp.WorkspaceIdFor(launch.Env["CODECHROMA_QUESTION_TOKEN"]));
    }

    [Fact]
    public void A_gemini_window_gets_a_system_settings_file_with_the_http_server()
    {
        UseAgentCli("gemini");

        var launch = _agents.Resolve("agent", agentId: "agent-1", bridgeUrl: BridgeUrl)!;

        var server = JsonNode.Parse(File.ReadAllText(launch.Env[CodeChroma.Bridge.Skills.GeminiAdapter.SettingsEnv]))!["mcpServers"]!["codechroma"]!;
        Assert.Equal(BridgeUrl + "/mcp/", (string?)server["httpUrl"]);
        Assert.Equal("Bearer " + launch.Env["CODECHROMA_QUESTION_TOKEN"], (string?)server["headers"]!["Authorization"]);
    }

    [Fact]
    public void A_kimi_window_merges_the_server_into_its_project_mcp_file_and_keeps_the_users_entries()
    {
        UseAgentCli("kimi-cli");
        var file = KimiMcpFile("""{"mcpServers":{"mine":{"command":"tool"}}}""");

        var launch = _agents.Resolve("agent", agentId: "agent-1", bridgeUrl: BridgeUrl, workdir: Path.Combine(_dir, "worktree"))!;

        var servers = JsonNode.Parse(File.ReadAllText(file))!["mcpServers"]!;
        Assert.Equal("tool", (string?)servers["mine"]!["command"]);
        Assert.Equal(BridgeUrl + "/mcp/", (string?)servers["codechroma"]!["url"]);
        Assert.Equal("CODECHROMA_QUESTION_TOKEN", (string?)servers["codechroma"]!["bearerTokenEnvVar"]);
        Assert.DoesNotContain(launch.Env["CODECHROMA_QUESTION_TOKEN"], File.ReadAllText(file));
    }

    [Fact]
    public void A_kimi_window_leaves_an_unreadable_mcp_file_alone_and_gets_no_server()
    {
        UseAgentCli("kimi-cli");
        var file = KimiMcpFile("{ broken");

        var launch = _agents.Resolve("agent", agentId: "agent-1", bridgeUrl: BridgeUrl, workdir: Path.Combine(_dir, "worktree"))!;

        Assert.Equal("{ broken", File.ReadAllText(file));
        Assert.False(launch.Env.ContainsKey("CODECHROMA_QUESTION_TOKEN"));
    }

    [Fact]
    public void A_kimi_window_leaves_a_git_tracked_mcp_file_alone_and_gets_no_server()
    {
        UseAgentCli("kimi-cli");
        var file = KimiMcpFile("""{"mcpServers":{}}""");
        var worktree = Path.Combine(_dir, "worktree");
        GitRunner.Run(worktree, "init", "-q");
        GitRunner.Run(worktree, "add", ".kimi-code/mcp.json");

        var launch = _agents.Resolve("agent", agentId: "agent-1", bridgeUrl: BridgeUrl, workdir: worktree)!;

        Assert.Equal("""{"mcpServers":{}}""", File.ReadAllText(file));
        Assert.False(launch.Env.ContainsKey("CODECHROMA_QUESTION_TOKEN"));
    }

    [Fact]
    public void A_kimi_window_gets_no_server_when_the_mcp_file_cannot_be_written()
    {
        UseAgentCli("kimi-cli");
        var worktree = Path.Combine(_dir, "worktree");
        Directory.CreateDirectory(worktree);
        File.WriteAllText(Path.Combine(worktree, ".kimi-code"), "not a folder");

        var launch = _agents.Resolve("agent", agentId: "agent-1", bridgeUrl: BridgeUrl, workdir: worktree)!;

        Assert.False(launch.Env.ContainsKey("CODECHROMA_QUESTION_TOKEN"));
    }

    [Fact]
    public void The_endpoint_signs_a_token_that_names_the_workspace()
    {
        var endpoint = _mcp.EndpointFor("agent-7", "http://127.0.0.1:8765");

        Assert.Equal("agent-7", _mcp.WorkspaceIdFor(endpoint.Token));
        Assert.Equal("http://127.0.0.1:8765/mcp/", endpoint.McpUrl);
    }

    [Fact]
    public void A_workspace_id_with_dots_round_trips_through_its_token()
    {
        var token = _mcp.TokenFor("wf.run.1");

        Assert.Equal("wf.run.1", _mcp.WorkspaceIdFor(token));
    }

    [Fact]
    public void The_grill_skill_ships_and_is_synced()
    {
        Assert.Contains("codechroma-grill", CodeChroma.Bridge.Agents.SkillSync.SkillNames);
        Assert.Contains("codechroma-decision-diagram", CodeChroma.Bridge.Agents.SkillSync.SkillNames);
    }
}
