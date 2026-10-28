using System.Text.Json.Nodes;
using CodeChroma.Bridge.Diagrams;
using CodeChroma.Bridge.Tests.Contract;
using CodeChroma.Bridge.Tests.Support;

namespace CodeChroma.Bridge.Tests.Diagrams;

public class SystemContextTests
{
    private static JsonObject Digest(params string[] declared) => new()
    {
        ["repo_name"] = "shop",
        ["declared_dependencies"] = new JsonArray(declared.Select(d => (JsonNode?)d).ToArray()),
        ["external_import_roots"] = new JsonArray(),
    };

    [Fact]
    public void A_database_driver_is_an_external_system_and_a_web_framework_is_a_user()
    {
        var found = SystemContext.Detect(Digest("psycopg2", "fastapi"));

        Assert.Equal([("postgresql", "external_system"), ("user", "person")], found.Select(c => (c.Name == "PostgreSQL" ? "postgresql" : c.Id, c.Kind)));
    }

    [Fact]
    public void Two_web_frameworks_make_one_user()
    {
        var found = SystemContext.Detect(Digest("flask", "react"));

        Assert.Single(found);
    }

    [Fact]
    public void An_unmatched_dependency_is_never_guessed()
    {
        Assert.Empty(SystemContext.Detect(Digest("left-pad")));
    }

    [Fact]
    public void The_fingerprint_moves_with_the_detected_set_only()
    {
        var before = SystemContext.Fingerprint(SystemContext.Detect(Digest("redis")));

        Assert.Equal(before, SystemContext.Fingerprint(SystemContext.Detect(Digest("redis", "left-pad"))));
        Assert.NotEqual(before, SystemContext.Fingerprint(SystemContext.Detect(Digest("redis", "stripe"))));
    }

    [Fact]
    public void The_generated_draft_carries_the_fingerprint_of_what_it_detected()
    {
        var c1 = C1Template.Generate(Digest("stripe", "click"));

        Assert.Equal(SystemContext.Fingerprint(SystemContext.Detect(Digest("stripe", "click"))), (string?)c1["fingerprint"]);
        Assert.Equal("person", (string?)c1["nodes"]![2]!["kind"]);
        Assert.Equal("system", (string?)c1["relations"]![1]!["to"]);
    }

    private static JsonObject Resolve(JsonObject digest, string authored) =>
        SystemContext.Resolve(
            new JsonSnapshotEngine(Path.Combine(ContractCases.FixtureDir, "engine_snapshot.sample_repo.json")),
            digest, JsonNode.Parse(authored)!.AsObject());

    private static string[] Ids(JsonObject resolved) => resolved["nodes"]!.AsArray().Select(n => (string)n!["id"]!).ToArray();

    [Fact]
    public void An_unreviewed_candidate_still_shows_with_a_default_arrow()
    {
        var resolved = Resolve(Digest("redis"), """{"nodes": [{"id": "system", "kind": "system", "name": "shop"}], "relations": []}""");

        Assert.Equal(["system", "redis"], Ids(resolved));
        Assert.Equal("Uses", (string?)resolved["relations"]![0]!["label"]);
    }

    [Fact]
    public void A_rejected_candidate_and_its_arrow_are_dropped()
    {
        var resolved = Resolve(Digest("redis"), """{"nodes": [{"id": "system", "kind": "system", "name": "shop"}, {"id": "redis", "kind": "external_system", "meta": {"confirmed": false}}]}""");

        Assert.Equal(["system"], Ids(resolved));
        Assert.Empty(resolved["relations"]!.AsArray());
    }

    [Fact]
    public void Authored_prose_wins_and_authored_only_people_are_kept()
    {
        var resolved = Resolve(Digest("redis"), """
            {"nodes": [{"id": "system", "kind": "system", "name": "shop"},
              {"id": "redis", "kind": "external_system", "name": "Sessions", "meta": {"confirmed": true}},
              {"id": "admin", "kind": "person", "name": "Admin"}],
             "relations": [{"from": "admin", "to": "system", "label": "Manages"}]}
            """);

        Assert.Equal(["system", "redis", "admin"], Ids(resolved));
        Assert.Equal("Sessions", (string?)resolved["nodes"]![1]!["name"]);
        Assert.Equal(2, resolved["relations"]!.AsArray().Count);
    }

    [Fact]
    public void A_changed_detected_set_marks_the_reviewed_diagram_stale()
    {
        var reviewed = SystemContext.Fingerprint(SystemContext.Detect(Digest("redis")));
        var authored = $$"""{"fingerprint": "{{reviewed}}", "nodes": [{"id": "system", "kind": "system", "name": "shop"}]}""";

        Assert.False((bool)Resolve(Digest("redis"), authored)["stale"]!);
        Assert.True((bool)Resolve(Digest("redis", "stripe"), authored)["stale"]!);
    }
}
