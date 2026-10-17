using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Tests.Support;
using Microsoft.Extensions.DependencyInjection;

namespace CodeChroma.Bridge.Tests.Skills;

public class AssistantTestRouteTests
{
    private sealed class Stub(HttpStatusCode status, string body) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
    }

    private static BridgeHost Host(HttpStatusCode status, string body) =>
        new(configure: services => services.AddSingleton(new HttpClient(new Stub(status, body))));

    private static async Task<JsonObject> Probe(BridgeHost host, string? key)
    {
        if (key is not null)
            await host.Client.PutAsJsonAsync("/assistant/settings", new JsonObject { ["cli"] = "definitely-not-installed-cli", ["api_key"] = key });
        return (await (await host.Client.PostAsync("/assistant/settings/test", null)).Content.ReadFromJsonAsync<JsonObject>())!;
    }

    [Fact]
    public async Task Without_any_key_the_probe_explains_what_is_missing()
    {
        using var host = Host(HttpStatusCode.OK, "{}");
        Environment.SetEnvironmentVariable("ANTHROPIC_API_KEY", null);

        var result = await Probe(host, null);

        Assert.False(result["ok"]!.GetValue<bool>());
        Assert.Equal("none", result["auth_source"]!.GetValue<string>());
        Assert.Contains("no API key configured", result["error"]!.GetValue<string>());
    }

    [Fact]
    public async Task With_a_working_key_the_probe_is_ok_even_when_the_cli_is_missing()
    {
        using var host = Host(HttpStatusCode.OK, """{"content":[{"type":"text","text":"ok"}]}""");

        var result = await Probe(host, "sk-test");

        Assert.True(result["ok"]!.GetValue<bool>());
        Assert.False(result["cli_found"]!.GetValue<bool>());
        Assert.Equal("settings", result["auth_source"]!.GetValue<string>());
        Assert.Equal("ok", result["message"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_rejected_key_reports_the_failure()
    {
        using var host = Host(HttpStatusCode.Unauthorized, "{}");

        var result = await Probe(host, "sk-bad");

        Assert.False(result["ok"]!.GetValue<bool>());
        Assert.Contains("401", result["error"]!.GetValue<string>());
    }
}
