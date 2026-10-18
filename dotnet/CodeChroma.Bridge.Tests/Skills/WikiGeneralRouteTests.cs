using System.Net.Http.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Engine;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Workspaces;
using Microsoft.Extensions.DependencyInjection;
using static CodeChroma.Bridge.Tests.Support.FakeCliHarness;

namespace CodeChroma.Bridge.Tests.Skills;

/// <summary>The wiki-general generate, update and clustering routes against a scripted fake CLI: no real Claude.</summary>
public sealed class WikiGeneralRouteTests : IDisposable
{
    private const string Worker = """{"type":"result","is_error":false,"structured_output":{"summary":"Short summary.","description":"A longer description.","narrative":"The system narrative.","assignments":[]}}""";

    private readonly FakeCliHarness _cli = new();
    private readonly BridgeHost _host = new(configure: services => services.AddSingleton<IEngineFactory>(
        new SnapshotEngineFactory(Path.Combine(CodeChroma.Bridge.Tests.Contract.ContractCases.FixtureDir, "engine_snapshot.sample_repo.json"))));
    private readonly JsonSnapshotEngine _engine;

    public WikiGeneralRouteTests()
    {
        var paths = _host.Factory.Services.GetRequiredService<UserPaths>();
        Directory.CreateDirectory(Path.GetDirectoryName(paths.Runtime)!);
        File.WriteAllText(paths.Runtime, new JsonObject { ["cli_paths"] = new JsonObject { ["claude"] = _cli.ExePath } }.ToJsonString());
        _engine = (JsonSnapshotEngine)_host.Factory.Services.GetRequiredService<WorkspaceRegistry>().Get("main").Engine;
        _engine.Graph = WikiGeneralTestData.Graph();
        _engine.Clusters = WikiGeneralTestData.TwoComponents();
    }

    public void Dispose()
    {
        _host.Dispose();
        _cli.Dispose();
    }

    private string Dir => Path.Combine(_host.Root, ".codechroma", "wiki-general");

    private async Task<JsonObject> Settled()
    {
        for (var i = 0; i < 800; i++)
        {
            var state = (await _host.Client.GetFromJsonAsync<JsonObject>("/repos/main/wiki-general/status"))!;
            if (state["state"]!.GetValue<string>() != "generating") return state;
            await Task.Delay(25);
        }
        throw new TimeoutException("run did not settle");
    }

    // The agent flips to idle just before the success callback stamps the commit.
    private async Task<bool> StaleAfterStamp()
    {
        var stale = true;
        for (var i = 0; i < 80 && stale; i++)
        {
            stale = (await _host.Client.GetFromJsonAsync<JsonObject>("/repos/main/wiki-general/status"))!["stale"]!.GetValue<bool>();
            if (stale) await Task.Delay(25);
        }
        return stale;
    }

    private async Task<JsonObject> Post(string route) =>
        (await (await _host.Client.PostAsync($"/repos/main/wiki-general/{route}", null)).Content.ReadFromJsonAsync<JsonObject>())!;

    [Fact]
    public async Task Clustering_serves_the_engines_grouping()
    {
        var body = await _host.Client.GetFromJsonAsync<JsonObject>("/repos/main/wiki-general/clustering");

        Assert.Equal(["c-a", "c-b"], body!["components"]!.AsArray().Select(c => c!["id"]!.GetValue<string>()));
        Assert.Equal("top::app", body["containers"]![0]!["id"]!.GetValue<string>());
        Assert.Empty(body["undetermined_files"]!.AsArray());
    }

    [Fact]
    public async Task Generate_runs_the_pipeline_and_writes_a_checked_page_tree()
    {
        _cli.Script(Stdout(Worker), Exit(0));

        var started = await Post("generate");
        var final = await Settled();

        Assert.Equal("generating", started["state"]!.GetValue<string>());
        Assert.Null(final["error"]);
        Assert.Equal("idle", final["state"]!.GetValue<string>());
        Assert.True(final["has_wiki_general"]!.GetValue<bool>());
        Assert.False(await StaleAfterStamp());
        Assert.True(File.Exists(Path.Combine(Dir, "index.md")));
        Assert.Contains("  - Function: `app/a.py::a_main`", File.ReadAllText(Path.Combine(Dir, "c3", "app.md")));
        Assert.Contains("The system narrative.", File.ReadAllText(Path.Combine(Dir, "index.md")));
    }

    [Fact]
    public async Task A_failing_worker_leaves_no_tree_and_reports_the_job_error()
    {
        _cli.Script(Stderr("boom"), Exit(1));

        await Post("generate");
        var final = await Settled();

        Assert.Equal("error", final["state"]!.GetValue<string>());
        Assert.StartsWith("write-c3 failed for ", final["error"]!.GetValue<string>());
        Assert.False(File.Exists(Path.Combine(Dir, "index.md")));
        Assert.False(final["has_wiki_general"]!.GetValue<bool>());
    }

    [Fact]
    public async Task Update_applies_the_delta_then_hands_the_skill_only_the_created_groups()
    {
        _cli.Script(Stdout(Worker), Exit(0));
        await Post("generate");
        await Settled();
        _engine.Graph = WikiGeneralTestData.Graph("lib/c.py");
        _engine.Clusters = WikiGeneralTestData.Clusters(("c-a", "top::app", ["app/a.py"]), ("c-b", "top::app", ["app/b.py"]), ("c-c", "top::lib", ["lib/c.py"]));
        var before = _cli.Invocations().Count;
        _cli.Script(Stdout("""{"type":"result","is_error":false}"""), Exit(0));

        var started = await Post("update");
        var final = await Settled();

        Assert.Equal("generating", started["state"]!.GetValue<string>());
        Assert.Equal("idle", final["state"]!.GetValue<string>());
        var manifest = (JsonObject)JsonNode.Parse(File.ReadAllText(Path.Combine(Dir, "manifest.json")))!;
        Assert.Contains(manifest["components"]!.AsArray(), c => c!["id"]!.GetValue<string>() == "lib" && c["path"]!.GetValue<string>() == "c3/lib.md");
        var prompt = _cli.Invocations()[before]["args"]![1]!.GetValue<string>();
        Assert.Contains("\"id\": \"lib\"", prompt);
    }

    [Fact]
    public async Task Update_without_a_graph_reports_the_failure_as_an_error_state()
    {
        _engine.Clusters = null;

        var reply = await Post("update");

        Assert.Equal("error", reply["state"]!.GetValue<string>());
        Assert.Contains("no graph", reply["error"]!.GetValue<string>());
    }
}
