using System.Net;
using CodeChroma.Bridge.Tests.Support;

namespace CodeChroma.Bridge.Tests.Workflows;

/// <summary>DELETE /repos/{id}/workflows/{wfId}: removes the definition file, 404 for an unknown id.</summary>
public sealed class WorkflowDeleteRouteTests : IDisposable
{
    private readonly BridgeHost _host = new();

    public void Dispose() => _host.Dispose();

    private string DefinitionPath(string id) => Path.Combine(_host.Root, ".codechroma", "workflows", id + ".json");

    [Fact]
    public async Task Deleting_a_saved_workflow_removes_its_definition()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(DefinitionPath("wf"))!);
        File.WriteAllText(DefinitionPath("wf"), """{"id": "wf", "name": "Wf", "steps": [{"id": "a", "slug": "a", "kind": "agent", "prompt": "go"}]}""");

        var response = await _host.Client.DeleteAsync("/repos/main/workflows/wf");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(File.Exists(DefinitionPath("wf")));
    }

    [Fact]
    public async Task Deleting_an_unknown_workflow_is_a_404()
    {
        var response = await _host.Client.DeleteAsync("/repos/main/workflows/missing");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
