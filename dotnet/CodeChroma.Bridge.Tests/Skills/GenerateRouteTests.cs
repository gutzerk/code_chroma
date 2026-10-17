using System.Net.Http.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Tests.Support;
using Microsoft.Extensions.DependencyInjection;
using static CodeChroma.Bridge.Tests.Support.FakeCliHarness;

namespace CodeChroma.Bridge.Tests.Skills;

/// <summary>The generate/status/output/cancel routes driving a real SkillAgent against a scripted fake CLI.</summary>
public sealed class GenerateRouteTests : IDisposable
{
    private readonly FakeCliHarness _cli = new();
    private readonly BridgeHost _host = new();

    public GenerateRouteTests() => UseCli(_cli.ExePath);

    public void Dispose()
    {
        _host.Dispose();
        _cli.Dispose();
    }

    private void UseCli(string path)
    {
        var paths = _host.Factory.Services.GetRequiredService<UserPaths>();
        Directory.CreateDirectory(Path.GetDirectoryName(paths.Runtime)!);
        File.WriteAllText(paths.Runtime, new JsonObject { ["cli_paths"] = new JsonObject { ["claude"] = path } }.ToJsonString());
    }

    private string C1Path => Path.Combine(_host.Root, ".codechroma", "diagrams", "c1", "c1.json");

    private async Task<JsonObject> Status(string kind)
    {
        for (var i = 0; i < 400; i++)
        {
            var state = (await _host.Client.GetFromJsonAsync<JsonObject>($"/repos/main/{kind}/status"))!;
            if (state["state"]!.GetValue<string>() != "generating") return state;
            await Task.Delay(25);
        }
        throw new TimeoutException("run did not settle");
    }

    [Fact]
    public async Task Generating_c1_runs_the_cli_and_serves_the_artifact_it_wrote()
    {
        _cli.Script(Stdout("""{"type":"assistant","message":{"content":[{"type":"text","text":"Drawing."}]}}"""),
            Write(C1Path, """{"type":"c1","nodes":[{"id":"system","name":"System"}],"relations":[]}"""), ResultEvent(), Exit(0));

        var started = await _host.Client.PostAsync("/repos/main/c1/generate", null);
        var final = await Status("c1");
        var output = await _host.Client.GetFromJsonAsync<JsonObject>("/repos/main/c1/output");
        var diagram = await _host.Client.GetFromJsonAsync<JsonObject>("/repos/main/c1");

        Assert.Equal("generating", (await started.Content.ReadFromJsonAsync<JsonObject>())!["state"]!.GetValue<string>());
        Assert.Equal("idle", final["state"]!.GetValue<string>());
        Assert.Equal("Drawing.", output!["lines"]![0]!.GetValue<string>());
        Assert.Equal("System", diagram!["nodes"]![0]!["name"]!.GetValue<string>());
        var call = Assert.Single(_cli.Invocations());
        Assert.StartsWith("/codechroma-draw-diagram type: c1", call["args"]![1]!.GetValue<string>());
    }

    [Fact]
    public async Task Only_if_missing_leaves_an_existing_valid_c1_alone()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(C1Path)!);
        File.WriteAllText(C1Path, """{"type":"c1","nodes":[{"id":"system","name":"System"}],"relations":[]}""");
        _cli.Script(Exit(0));

        var response = await _host.Client.PostAsync("/repos/main/c1/generate?only_if_missing=true", null);

        Assert.Equal("idle", (await response.Content.ReadFromJsonAsync<JsonObject>())!["state"]!.GetValue<string>());
        Assert.Empty(_cli.Invocations());
    }

    [Fact]
    public async Task A_failing_run_reports_the_error_and_cancel_resets_to_idle()
    {
        _cli.Script(Stdout("""{"type":"result","is_error":true,"result":"API Error: nope"}"""), Exit(1));

        await _host.Client.PostAsync("/repos/main/c1/generate", null);
        var failed = await Status("c1");
        var cancelled = await (await _host.Client.PostAsync("/repos/main/c1/cancel", null)).Content.ReadFromJsonAsync<JsonObject>();

        Assert.Equal("error", failed["state"]!.GetValue<string>());
        Assert.Equal("✗ API Error: nope", failed["error"]!.GetValue<string>());
        Assert.Equal("idle", cancelled!["state"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_missing_cli_is_an_error_state_not_a_server_error()
    {
        UseCli(Path.Combine(_host.Root, "missing", "claude"));

        var response = await _host.Client.PostAsync("/repos/main/c1/generate", null);
        var body = await response.Content.ReadFromJsonAsync<JsonObject>();

        Assert.True(response.IsSuccessStatusCode);
        Assert.Equal("error", body!["state"]!.GetValue<string>());
        Assert.Contains("does not exist", body["error"]!.GetValue<string>());
    }

    [Fact]
    public async Task The_impact_change_review_runs_through_the_same_quartet()
    {
        var review = Path.Combine(_host.Root, ".codechroma", "impact-changes.json");
        _cli.Script(Write(review, "{\"summary\":\"ok\"}"), ResultEvent(), Exit(0));

        await _host.Client.PostAsync("/repos/main/impact-changes/generate", null);
        var final = await Status("impact-changes");

        Assert.Equal("idle", final["state"]!.GetValue<string>());
        Assert.StartsWith("/codechroma-review-diagram", _cli.Invocations()[0]["args"]![1]!.GetValue<string>());
    }

    [Fact]
    public async Task Run_progress_is_pushed_to_connected_canvases_over_the_events_socket()
    {
        var socket = await _host.Server.CreateWebSocketClient().ConnectAsync(new Uri("ws://localhost/repos/main/events"), CancellationToken.None);
        _cli.Script(Write(C1Path, """{"type":"c1","nodes":[{"id":"system","name":"System"}],"relations":[]}"""), ResultEvent(), Exit(0));

        await _host.Client.PostAsync("/repos/main/c1/generate", null);
        var seen = new List<string>();
        var buffer = new byte[8192];
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        while (!seen.Any(m => m.Contains("\"c1-status\"") && m.Contains("\"idle\"")))
        {
            var result = await socket.ReceiveAsync(buffer, timeout.Token);
            seen.Add(System.Text.Encoding.UTF8.GetString(buffer, 0, result.Count));
        }

        Assert.Contains(seen, m => m.Contains("\"c1-status\"") && m.Contains("\"generating\""));
        Assert.Contains(seen, m => m.Contains("\"c1-output\""));
    }
}
