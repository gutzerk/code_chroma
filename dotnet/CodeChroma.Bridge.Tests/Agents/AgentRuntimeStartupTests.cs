using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Terminal;
using CodeChroma.Bridge.Tests.Support;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace CodeChroma.Bridge.Tests.Agents;

[Collection("Env")]
public class AgentRuntimeStartupTests
{
    [Fact]
    public void Listening_address_is_available_to_agent_launches_after_hosted_services_start()
    {
        var previous = BareSkill.BridgeUrl;
        var probe = new StartupProbe();
        try
        {
            using var host = new BridgeHost(configure: services => services.AddSingleton<IHostedService>(sp => probe.WithServices(sp)));
            Assert.NotNull(probe.Launch);
            Assert.Contains("--mcp-config", probe.Launch.Argv);
            Assert.Equal(StartupProbe.Address, probe.Launch.Env[BridgeAddress.BridgeUrlEnv]);
            Assert.Equal(probe.AgentId, host.Factory.Services.GetRequiredService<QuestionMcp>()
                .WorkspaceIdFor(probe.Launch.Env[McpEndpoint.TokenEnv]));
            var config = JsonNode.Parse(File.ReadAllText(probe.Launch.Argv[probe.Launch.Argv.ToList().IndexOf("--mcp-config") + 1]))!;
            Assert.Equal(StartupProbe.Address + "/mcp/", (string?)config["mcpServers"]!["codechroma"]!["url"]);
        }
        finally
        {
            BareSkill.BridgeUrl = previous;
            if (probe.Launch is { } launch && launch.Argv.Contains("--mcp-config")) File.Delete(launch.Argv[launch.Argv.ToList().IndexOf("--mcp-config") + 1]);
        }
    }

    // Simulates a server whose listening address is learned during StartAsync, after AgentRuntime.StartAsync.
    private sealed class StartupProbe : IHostedLifecycleService
    {
        public const string Address = "http://127.0.0.1:8123";
        public string AgentId { get; } = "startup-" + Guid.NewGuid().ToString("N");
        public AgentLaunch? Launch { get; private set; }
        private IServiceProvider _services = null!;

        public Task StartingAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task StartAsync(CancellationToken cancellationToken)
        {
            BareSkill.BridgeUrl = null;
            var addresses = new ServerAddressesFeature();
            addresses.Addresses.Add(Address);
            _services.GetRequiredService<IServer>().Features.Set<IServerAddressesFeature>(addresses);
            return Task.CompletedTask;
        }
        public Task StartedAsync(CancellationToken cancellationToken)
        {
            Launch = _services.GetRequiredService<TerminalAgents>().Resolve("claude", "saved-session", agentId: AgentId, bridgeUrl: BareSkill.BridgeUrl);
            return Task.CompletedTask;
        }
        public Task StoppingAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
        public Task StoppedAsync(CancellationToken cancellationToken) => Task.CompletedTask;

        public StartupProbe WithServices(IServiceProvider services)
        {
            _services = services;
            return this;
        }
    }
}
