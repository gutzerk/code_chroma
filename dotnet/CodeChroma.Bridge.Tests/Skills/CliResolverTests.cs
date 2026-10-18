using System.Text.Json.Nodes;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Tests.Skills;

public sealed class CliResolverTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "cc-resolver-" + Guid.NewGuid().ToString("N")[..8]);
    private readonly UserPaths _paths;
    private readonly ProviderStore _providers;
    private readonly CallSiteStore _sites;
    private readonly CliResolver _resolver;

    public CliResolverTests()
    {
        _paths = UserPaths.Under(_dir);
        _providers = new ProviderStore(_paths);
        _sites = new CallSiteStore(_paths, _providers);
        _resolver = new CliResolver(_paths, _providers, _sites);
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { }
    }

    private string Group => LlmCatalog.GroupOf("c1_agent")!;

    private void Assign(JsonObject provider, string model) => _sites.SaveGroup(Group, new JsonObject { ["provider_id"] = Json.Str(provider["id"]), ["model"] = model });

    [Fact]
    public void An_unassigned_call_site_falls_back_to_the_assistant_cli_and_the_default_model()
    {
        var resolution = _resolver.Resolve("c1_agent", "haiku");

        Assert.Equal(("claude", "claude", "haiku", false), (resolution.AdapterKey, resolution.Binary, resolution.Model, resolution.ProviderAssigned));
        Assert.Empty(resolution.EnvOverrides);
    }

    [Fact]
    public void The_assistant_settings_choose_the_binary_and_model_when_nothing_is_assigned()
    {
        Directory.CreateDirectory(_dir);
        File.WriteAllText(_paths.Assistant, """{"cli":"my-claude","model":"opus"}""");

        var resolution = _resolver.Resolve("c1_agent", "haiku");

        Assert.Equal(("my-claude", "opus", false), (resolution.Binary, resolution.Model, resolution.ProviderAssigned));
    }

    [Fact]
    public void An_assigned_cli_provider_picks_its_adapter_binary_and_model()
    {
        var provider = _providers.Create(new JsonObject { ["label"] = "Codex", ["kind"] = "cli", ["adapter"] = "codex" });
        Assign(provider, "gpt-5");

        var resolution = _resolver.Resolve("c1_agent", "haiku");

        Assert.Equal(("codex", "codex", "gpt-5", true), (resolution.AdapterKey, resolution.Binary, resolution.Model, resolution.ProviderAssigned));
        Assert.Empty(resolution.EnvOverrides);
    }

    [Fact]
    public void A_claude_provider_with_a_base_url_routes_through_the_environment()
    {
        var provider = _providers.Create(new JsonObject
        {
            ["label"] = "Proxy", ["kind"] = "cli", ["adapter"] = "claude", ["base_url"] = "https://proxy.example",
            ["api_key"] = "sk-proxy", ["verify_ssl"] = false,
        });
        Assign(provider, "sonnet");

        var env = _resolver.Resolve("c1_agent", "haiku").EnvOverrides;

        Assert.Equal("https://proxy.example", env["ANTHROPIC_BASE_URL"]);
        Assert.Equal("", env["ANTHROPIC_API_KEY"]);
        Assert.Equal("sonnet", env["ANTHROPIC_MODEL"]);
        Assert.Equal("sk-proxy", env["ANTHROPIC_AUTH_TOKEN"]);
        Assert.Equal("0", env["NODE_TLS_REJECT_UNAUTHORIZED"]);
    }

    [Fact]
    public void A_key_file_supplies_the_first_non_comment_line()
    {
        Directory.CreateDirectory(_dir);
        var keyFile = Path.Combine(_dir, "key.txt");
        File.WriteAllText(keyFile, "# comment\n\n  sk-from-file  \nsk-second\n");

        Assert.Equal("sk-from-file", ProviderKeys.From(null, keyFile));
        Assert.Equal("direct", ProviderKeys.From("direct", keyFile));
        Assert.Null(ProviderKeys.From(null, Path.Combine(_dir, "missing")));
    }
}
