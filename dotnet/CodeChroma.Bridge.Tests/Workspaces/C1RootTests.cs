using System.Text.Json.Nodes;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Workspaces;
using Microsoft.Extensions.DependencyInjection;

namespace CodeChroma.Bridge.Tests.Workspaces;

public class C1RootTests
{
    private static void WriteC1(string root)
    {
        var path = Workspace.DiagramPath(root, "system-context");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, """{"nodes":[{"id":"system","name":"S"}],"relations":[]}""");
    }

    [Fact]
    public async Task A_workspace_with_a_borrowed_c1_root_reports_the_source_c1_ready()
    {
        using var host = new BridgeHost();
        WriteC1(host.Root);
        var other = Directory.CreateTempSubdirectory("cc-pr-").FullName;
        host.Factory.Services.GetRequiredService<WorkspaceRegistry>().Register("pr-1", other, readOnly: true, c1SourceRoot: host.Root);

        var status = JsonNode.Parse(await host.Client.GetStringAsync("/repos/pr-1/diagrams/status"))!;

        Assert.True(status["system-context"]!["ready"]!.GetValue<bool>());
    }

    [Fact]
    public void C1Root_falls_back_to_the_own_root()
    {
        using var host = new BridgeHost();
        var main = host.Factory.Services.GetRequiredService<WorkspaceRegistry>().Get("main");

        Assert.Equal(main.Root, main.C1Root);
    }
}
