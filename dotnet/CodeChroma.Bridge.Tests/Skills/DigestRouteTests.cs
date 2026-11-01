using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Engine;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Workspaces;
using Microsoft.Extensions.DependencyInjection;

namespace CodeChroma.Bridge.Tests.Skills;

/// <summary>The dependency-digest, context-digest and route graph routes over a hand-built graph snapshot.</summary>
public sealed class DigestRouteTests : IDisposable
{
    private readonly BridgeHost _host = new(configure: services => services.AddSingleton<IEngineFactory>(
        new SnapshotEngineFactory(Path.Combine(CodeChroma.Bridge.Tests.Contract.ContractCases.FixtureDir, "engine_snapshot.sample_repo.json"))));

    public DigestRouteTests()
    {
        var engine = (JsonSnapshotEngine)_host.Factory.Services.GetRequiredService<WorkspaceRegistry>().Get("main").Engine;
        engine.Graph = WikiGeneralTestData.Graph();
    }

    public void Dispose() => _host.Dispose();

    [Fact]
    public async Task DependencyDigest_ReturnsTheWholeDigest()
    {
        var response = await _host.Client.GetAsync("/repos/main/dependency-digest");

        var body = await response.Content.ReadFromJsonAsync<JsonObject>();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotNull(body!["files"]);
    }

    [Fact]
    public async Task DependencyDigest_WithAnUnknownPath_Is404()
    {
        var response = await _host.Client.GetAsync("/repos/main/dependency-digest?path=nope.py");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task ContextDigest_ReportsTheRepoNameAndSections()
    {
        var response = await _host.Client.GetAsync("/repos/main/context-digest");

        var body = await response.Content.ReadFromJsonAsync<JsonObject>();
        Assert.Equal("repo", (string?)body!["repo_name"]);
        Assert.NotNull(body["external_import_roots"]);
        Assert.NotNull(body["declared_dependencies"]);
    }

    [Fact]
    public async Task Route_BetweenUnknownNodes_ReturnsANullPath()
    {
        var response = await _host.Client.GetAsync("/repos/main/route?from=a&to=b");

        var body = await response.Content.ReadFromJsonAsync<JsonObject>();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Null(body!["path"]);
    }

    [Fact]
    public async Task Route_WithoutEndpoints_Is422()
    {
        var response = await _host.Client.GetAsync("/repos/main/route?from=a");

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
    }
}
