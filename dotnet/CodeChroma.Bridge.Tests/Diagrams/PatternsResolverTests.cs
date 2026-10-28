using System.Text.Json.Nodes;
using CodeChroma.Bridge.Diagrams;
using CodeChroma.Bridge.Tests.Contract;
using CodeChroma.Bridge.Tests.Support;

namespace CodeChroma.Bridge.Tests.Diagrams;

public class PatternsResolverTests
{
    [Fact]
    public void An_authored_infra_node_is_kept_without_reusing_the_file_nodes()
    {
        var engine = new JsonSnapshotEngine(Path.Combine(ContractCases.FixtureDir, "engine_snapshot.sample_repo.json"));
        var authored = JsonNode.Parse("""{"nodes": [{"id": "db", "name": "Database", "kind": "infra"}], "relations": []}""")!.AsObject();

        var resolved = PatternsResolver.Resolve(engine, authored);

        Assert.Contains(resolved["nodes"]!.AsArray(), n => (string?)n!["id"] == "db");
    }
}
