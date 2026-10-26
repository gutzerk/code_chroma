using System.Text.Json.Nodes;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Terminal;

namespace CodeChroma.Bridge.Tests.Questions;

/// <summary>Agent wiring: MCP argv registration, env, the config file and the signed token.</summary>
public sealed class QuestionAgentWiringTests : IDisposable
{
    private const string BridgeUrl = "http://127.0.0.1:8123";
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "cc-qwire-" + Guid.NewGuid().ToString("N")[..8]);
    private readonly QuestionMcp _mcp = new(_ => throw new InvalidOperationException("no workspace in this test"));
    private readonly TerminalAgents _agents;

    public QuestionAgentWiringTests()
    {
        var paths = UserPaths.Under(_dir);
        var providers = new ProviderStore(paths);
        _agents = new TerminalAgents(paths, providers, new CallSiteStore(paths, providers), _mcp);
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
    public void The_mcp_config_file_holds_an_http_server_with_a_bearer_header_and_a_long_timeout()
    {
        var launch = _agents.Resolve("claude", agentId: "agent-1", bridgeUrl: BridgeUrl)!;

        var server = JsonNode.Parse(File.ReadAllText(launch.Argv[launch.Argv.ToList().IndexOf("--mcp-config") + 1]))!["mcpServers"]!["codechroma"]!;

        Assert.Equal("http", (string?)server["type"]);
        Assert.Equal(BridgeUrl + "/mcp/", (string?)server["url"]);
        Assert.Equal("Bearer " + launch.Env["CODECHROMA_QUESTION_TOKEN"], (string?)server["headers"]!["Authorization"]);
        Assert.True((int)server["timeout"]! > 300_000);
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
