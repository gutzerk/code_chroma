using System.Text.Json.Nodes;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Terminal;

namespace CodeChroma.Bridge.Tests.Questions;

/// <summary>Port of the argv/env parts of tests/unit/test_question_agent_wiring.py.</summary>
public sealed class QuestionAgentWiringTests : IDisposable
{
    private static readonly McpEndpoint Endpoint = new("agent-1", "http://127.0.0.1:8123", "agent-1.sig", TimeSpan.FromSeconds(300));
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "cc-qwire-" + Guid.NewGuid().ToString("N")[..8]);
    private readonly TerminalAgents _agents;

    public QuestionAgentWiringTests()
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
    public void Claude_argv_registers_the_mcp_config_before_the_plugin_dir()
    {
        var launch = _agents.Resolve("claude", mcp: Endpoint)!;

        var at = launch.Argv.ToList().IndexOf("--mcp-config");
        Assert.Equal(1, at);
        if (launch.Argv.Contains("--plugin-dir")) Assert.Equal(3, launch.Argv.ToList().IndexOf("--plugin-dir"));
        Assert.Equal("http://127.0.0.1:8123", launch.Env["CODECHROMA_BRIDGE_URL"]);
        Assert.Equal("agent-1.sig", launch.Env["CODECHROMA_QUESTION_TOKEN"]);
    }

    [Fact]
    public void The_mcp_config_file_holds_an_http_server_with_a_bearer_header_and_a_long_timeout()
    {
        var path = _agents.Resolve("claude", mcp: Endpoint)!.Argv.SkipWhile(a => a != "--mcp-config").ElementAt(1);

        var server = JsonNode.Parse(File.ReadAllText(path))!["mcpServers"]!["codechroma"]!;

        Assert.Equal("http", server["type"]!.GetValue<string>());
        Assert.Equal("http://127.0.0.1:8123/mcp/", server["url"]!.GetValue<string>());
        Assert.Equal("Bearer agent-1.sig", server["headers"]!["Authorization"]!.GetValue<string>());
        Assert.True(server["timeout"]!.GetValue<int>() > 300_000);
    }

    [Fact]
    public void Claude_argv_is_unchanged_without_an_endpoint()
    {
        var launch = _agents.Resolve("claude")!;

        Assert.DoesNotContain("--mcp-config", launch.Argv);
        Assert.DoesNotContain("CODECHROMA_QUESTION_TOKEN", launch.Env.Keys);
    }

    [Fact]
    public void A_bare_window_gets_no_question_server_and_no_token()
    {
        var launch = _agents.Resolve("claude", null, "draw it", bare: true, mcp: Endpoint)!;

        Assert.DoesNotContain(launch.Argv, a => a == "--mcp-config");
        Assert.DoesNotContain("CODECHROMA_QUESTION_TOKEN", launch.Env.Keys);
    }

    [Fact]
    public void A_resumed_window_keeps_the_question_server()
    {
        var launch = _agents.Resolve("claude", "session-1", mcp: Endpoint)!;

        Assert.Contains("--mcp-config", launch.Argv);
        Assert.Contains("--resume", launch.Argv);
    }

    [Fact]
    public void The_endpoint_needs_a_known_bridge_url_and_signs_a_token_naming_the_workspace()
    {
        var mcp = new QuestionMcp(new QuestionBroker(), _ => throw new InvalidOperationException());

        var endpoint = mcp.EndpointFor("agent-7", "http://127.0.0.1:8765/");

        Assert.Null(mcp.EndpointFor("agent-7", null));
        Assert.Equal("http://127.0.0.1:8765", endpoint!.BaseUrl);
        Assert.Equal("agent-7", mcp.WorkspaceIdFor(endpoint.Token));
    }
}
