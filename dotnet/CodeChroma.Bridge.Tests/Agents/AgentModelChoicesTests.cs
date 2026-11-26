using System.Net;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Terminal;
using CodeChroma.Bridge.Tests.Questions;
using CodeChroma.Bridge.Tests.Support;

namespace CodeChroma.Bridge.Tests.Agents;

/// <summary>The "Run new agent" long-press model menu: GET /agents/models, `model` on POST /agents, and the per-agent `--model` it launches with.</summary>
public sealed class AgentModelChoicesTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "cc-models-" + Guid.NewGuid().ToString("N")[..8]);
    private readonly UserPaths _paths;
    private readonly ProviderStore _providers;
    private readonly CallSiteStore _callSites;

    public AgentModelChoicesTests()
    {
        _paths = UserPaths.Under(_dir);
        _providers = new ProviderStore(_paths);
        _callSites = new CallSiteStore(_paths, _providers);
        ModelCatalog.CliProbe = (_, _) => Task.FromResult<JsonArray?>(null);
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { }
    }

    private string CatalogDir(string json)
    {
        var dir = Path.Combine(_dir, "model-catalog");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "cc.json"), json);
        return dir;
    }

    [Fact]
    public async Task The_default_claude_agent_lists_the_models_from_claude_codes_cached_catalog()
    {
        var dir = CatalogDir("""{"fetchedAt":2,"catalog":{"config":{"models":[{"id":"claude-opus-5-5","display_name":"Opus 5.5"},{"id":"claude-haiku-5-5"}]}}}""");

        var choices = await AgentModelChoices.For(_callSites, _providers, _paths, null, dir);

        Assert.Equal("cache", choices["source"]!.GetValue<string>());
        Assert.Equal(["claude-opus-5-5", "claude-haiku-5-5"], ((JsonArray)choices["models"]!).Select(m => m!["id"]!.GetValue<string>()));
        Assert.Equal("Opus 5.5", choices["models"]![0]!["label"]!.GetValue<string>());
    }

    [Fact]
    public async Task Without_a_cache_the_list_comes_from_the_provider_catalog_like_the_llm_settings()
    {
        var provider = _providers.Create(new JsonObject { ["label"] = "Codex", ["kind"] = "cli", ["adapter"] = "codex" });
        _callSites.SaveGroup("agents", new JsonObject { ["provider_id"] = (string)provider["id"]!, ["model"] = "gpt-5.2" });

        var choices = await AgentModelChoices.For(_callSites, _providers, _paths, null, Path.Combine(_dir, "none"));

        Assert.Equal("static", choices["source"]!.GetValue<string>());
        Assert.Equal("Codex", choices["provider_name"]!.GetValue<string>());
        Assert.Equal("gpt-5.2", choices["current"]!.GetValue<string>());
        Assert.Contains("gpt-5.2-codex", ((JsonArray)choices["models"]!).Select(m => m!["id"]!.GetValue<string>()));
    }

    [Fact]
    public void A_picked_model_overrides_the_agents_group_model()
    {
        var provider = _providers.Create(new JsonObject { ["label"] = "Claude", ["kind"] = "cli", ["adapter"] = "claude" });
        _callSites.SaveGroup("agents", new JsonObject { ["provider_id"] = (string)provider["id"]!, ["model"] = "opus" });

        var argv = new TerminalAgents(_paths, _providers, _callSites).Resolve("agent", model: "haiku")!.Argv;

        Assert.Equal("claude", argv[0]);
        Assert.Equal(["--model", "haiku"], argv.Skip(argv.ToList().IndexOf("--model")).Take(2));
        Assert.Single(argv, "--model");
    }

    [Fact]
    public void A_claude_window_with_a_picked_model_passes_it_as_model()
    {
        var argv = new TerminalAgents(_paths, _providers, _callSites).Resolve("claude", model: "sonnet")!.Argv;

        Assert.Equal(["--model", "sonnet"], argv.Skip(argv.ToList().IndexOf("--model")).Take(2));
    }

    [Fact]
    public async Task A_claude_alias_marks_its_catalog_id_as_current()
    {
        JsonFile.Write(_paths.Assistant, new JsonObject { ["model"] = "opus" });
        var dir = CatalogDir("""{"fetchedAt":2,"catalog":{"config":{"models":[{"id":"claude-sonnet-5-5"},{"id":"claude-opus-5-5"}]}}}""");

        var choices = await AgentModelChoices.For(_callSites, _providers, _paths, null, dir);

        Assert.Equal("claude-opus-5-5", choices["current_id"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("claude-opus-5-5-20260101", "claude-opus-5-5")]
    [InlineData("gpt-5.2", "gpt-5.2")]
    [InlineData("mistral", null)]
    public void The_current_id_is_the_listed_id_the_model_names(string current, string? expected)
    {
        var models = new JsonArray(new JsonObject { ["id"] = "claude-opus-5-5" }, new JsonObject { ["id"] = "gpt-5.2" });

        var id = AgentModelChoices.CurrentId(models, current);

        Assert.Equal(expected, id);
    }

    [Fact]
    public void A_claude_window_on_a_stand_in_binary_gets_no_model_flag()
    {
        JsonFile.Write(_paths.Assistant, new JsonObject { ["cli"] = "my-wrapper" });

        var argv = new TerminalAgents(_paths, _providers, _callSites).Resolve("claude", model: "sonnet")!.Argv;

        Assert.DoesNotContain("--model", argv);
    }

    [Theory]
    [InlineData("--dangerously-skip-permissions")]
    [InlineData("opus; rm -rf /")]
    [InlineData("")]
    public void An_unsafe_model_id_is_dropped(string model)
    {
        var cleaned = AgentRecord.CleanModel(model);

        Assert.Null(cleaned);
    }
}

/// <summary>POST /agents keeps the picked model on the record; a non-id model is refused.</summary>
public sealed class AgentModelRouteTests : IDisposable
{
    private readonly BridgeHost _host = new();

    public void Dispose() => _host.Dispose();

    private static StringContent Json(object body) => QuestionTestKit.JsonBody(System.Text.Json.JsonSerializer.SerializeToNode(body)!);

    [Fact]
    public async Task A_new_agent_keeps_the_picked_model()
    {
        var tab = await Terminal.TerminalSocketTests.EnsureTab(_host);

        var made = await QuestionTestKit.Body(await _host.Client.PostAsync("/agents", Json(new { title = "a", workspace = tab, model = "claude-haiku-5-5" })));

        Assert.Equal("claude-haiku-5-5", made["model"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_model_that_is_not_an_id_is_refused()
    {
        var tab = await Terminal.TerminalSocketTests.EnsureTab(_host);

        var response = await _host.Client.PostAsync("/agents", Json(new { title = "a", workspace = tab, model = "--yolo" }));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }
}
