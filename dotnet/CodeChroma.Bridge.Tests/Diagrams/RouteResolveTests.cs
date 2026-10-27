using System.Text.Json.Nodes;
using CodeChroma.Bridge.Diagrams;
using CodeChroma.Bridge.Tests.Contract;
using CodeChroma.Bridge.Tests.Support;

namespace CodeChroma.Bridge.Tests.Diagrams;

public class RouteResolveTests
{
    private const string Create = "billing/service.py::function::BillingService.create_invoice";

    private static JsonObject Resolved()
    {
        var engine = new JsonSnapshotEngine(Path.Combine(ContractCases.FixtureDir, "engine_snapshot.sample_repo.json"));
        var data = JsonNode.Parse($$$"""
            {"nodes": [], "relations": [], "route": {"id": "r1", "steps": [{"id": "s1", "kind": "decide",
              "node_ids": ["{{{Create}}}", "component::billing/service.py", "nope::id"],
              "children": [
                {"id": "c1", "label": "a", "line": 99, "node_id": "{{{Create}}}"},
                {"id": "c2", "label": "b", "line": 8, "node_id": "billing/service.py::function::BillingService.__init__"},
                {"id": "c3", "label": "c", "line": 3, "node_id": "ghost::fn"}]}]}}
            """)!.AsObject();
        return DiagramResolver.Resolve(engine, data);
    }

    [Fact]
    public void Step_node_ids_resolve_to_path_and_line()
    {
        var step = Resolved()["route"]!["steps"]![0]!;

        Assert.Equal(2, step["resolved"]!.AsArray().Count);
        Assert.Equal(11, (int)step["resolved"]![0]!["line"]!);
        Assert.Equal("billing/service.py", (string?)step["resolved"]![1]!["path"]);
        Assert.Null(step["resolved"]![1]!["line"]);
    }

    [Fact]
    public void A_child_is_flagged_only_when_its_authored_line_differs()
    {
        var children = Resolved()["route"]!["steps"]![0]!["children"]!;

        Assert.True((bool)children[0]!["line_mismatch"]!);
        Assert.Equal(11, (int)children[0]!["resolved_line"]!);
        Assert.Null(children[1]!["line_mismatch"]);
        Assert.Null(children[2]!["path"]);
    }

    [Fact]
    public void Unresolved_ids_are_soft_diagnostics_only()
    {
        var resolved = Resolved();

        var what = resolved["diagnostics"]!["dropped"]!.AsArray().Select(d => (string?)d!["what"]);
        Assert.Equal(["route_step", "route_child"], what);
        Assert.Equal(3, resolved["route"]!["steps"]![0]!["node_ids"]!.AsArray().Count);
    }

    [Fact]
    public void The_summary_falls_back_to_node_ids_when_no_resolved_hit_has_a_path()
    {
        var steps = JsonNode.Parse("""[{"id":"s","kind":"ai","resolved":[{"node_id":"x"}],"node_ids":["x"]}]""")!.AsArray();

        var summary = DiagramResolver.RouteSummary(steps);

        Assert.Equal("1 steps · 1 files · 1 AI steps", summary);
    }
}
