using System.Text.Json.Nodes;
using CodeChroma.Bridge.Diagrams;

namespace CodeChroma.Bridge.Tests.Diagrams;

public class C1TemplateTests
{
    private static JsonObject Digest(string[] declared, params string[] roots) => new()
    {
        ["repo_name"] = "shop",
        ["declared_dependencies"] = new JsonArray(declared.Select(d => (JsonNode?)d).ToArray()),
        ["external_import_roots"] = new JsonArray(roots.Select(r => (JsonNode?)new JsonObject { ["root"] = r, ["count"] = 1 }).ToArray()),
    };

    [Fact]
    public void The_system_node_carries_the_repo_name_and_the_draft_marker()
    {
        var c1 = C1Template.Generate(Digest([]));

        Assert.True((bool)c1["draft"]!);
        Assert.Equal("shop", (string?)c1["nodes"]![0]!["name"]);
        Assert.Equal("The shop codebase.", (string?)c1["nodes"]![0]!["description"]);
    }

    [Fact]
    public void A_known_dependency_becomes_a_used_external_system()
    {
        var c1 = C1Template.Generate(Digest(["stripe"]));

        Assert.Equal("Stripe", (string?)c1["nodes"]![1]!["name"]);
        Assert.Equal("stripe", (string?)c1["nodes"]![1]!["icon"]);
        Assert.Equal("Uses", (string?)c1["relations"]![0]!["label"]);
    }

    [Fact]
    public void Two_keys_sharing_a_display_name_make_one_box()
    {
        var c1 = C1Template.Generate(Digest(["psycopg2"], "asyncpg", "redis"));

        Assert.Equal(["shop", "PostgreSQL", "Redis"], c1["nodes"]!.AsArray().Select(n => (string?)n!["name"]));
    }

    [Fact]
    public void A_go_module_path_matches_and_aws_has_no_icon()
    {
        var c1 = C1Template.Generate(Digest(["github.com/lib/pq", "github.com/aws/aws-sdk-go"]));

        Assert.Equal("PostgreSQL", (string?)c1["nodes"]![1]!["name"]);
        Assert.Null(c1["nodes"]![2]!["icon"]);
    }
}
