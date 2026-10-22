using System.Net;
using System.Net.Http.Json;
using CodeChroma.Bridge.Workflows;
using CodeChroma.Bridge.Tests.Support;

namespace CodeChroma.Bridge.Tests.Workflows;

/// <summary>DELETE /repos/{id}/workflows/{wfId}: removes the definition file, 404 for an unknown id.</summary>
public sealed class WorkflowDeleteRouteTests : IDisposable
{
    private readonly BridgeHost _host = new();

    public void Dispose() => _host.Dispose();

    private string DefinitionPath(string id) => Path.Combine(_host.Root, ".codechroma", "workflows", id + ".json");

    [Fact]
    public async Task A_saved_workflow_with_step_inputs_can_be_renamed_and_duplicated()
    {
        var definition = new WorkflowDef
        {
            Id = "wf", Name = "Flow",
            Steps = [new WorkflowStep { Id = "one", Slug = "one", Prompt = "Do {{ticket}}", Input = new WorkflowInput { Name = "ticket", Label = "Ticket" } }],
        };
        var created = await _host.Client.PostAsJsonAsync("/repos/main/workflows", definition, WorkflowJson.Options);
        created.EnsureSuccessStatusCode();
        var saved = await _host.Client.GetFromJsonAsync<List<WorkflowDef>>("/repos/main/workflows", WorkflowJson.Options);
        var renamed = saved!.Single();
        renamed.Name = "Renamed";
        var updated = await _host.Client.PutAsJsonAsync("/repos/main/workflows/wf", renamed, WorkflowJson.Options);
        renamed.Id = "wf-copy";
        var copied = await _host.Client.PostAsJsonAsync("/repos/main/workflows", renamed, WorkflowJson.Options);
        var results = await _host.Client.GetFromJsonAsync<List<WorkflowDef>>("/repos/main/workflows", WorkflowJson.Options);

        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        Assert.Equal(HttpStatusCode.OK, copied.StatusCode);
        Assert.Equal(2, results!.Count);
        Assert.All(results, w =>
        {
            Assert.Equal("Renamed", w.Name);
            Assert.Equal("ticket", Assert.Single(w.Inputs).Name);
            Assert.Equal("ticket", Assert.Single(w.Steps).Input!.Name);
        });
    }

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
