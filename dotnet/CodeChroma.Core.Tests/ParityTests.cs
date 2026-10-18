using System.Text.Json.Nodes;

namespace CodeChroma.Core.Tests;

/// <summary>Diffs the C# core against the Python engine's exported goldens, node for node.</summary>
public class ParityTests
{
    public static TheoryData<string> AllRepos() => Fixtures.RepoData();

    private static void AssertSame(JsonNode? expected, JsonNode? actual, string what)
    {
        if (JsonNode.DeepEquals(expected, actual)) return;
        Assert.Fail($"{what} differs from the Python golden.\nexpected: {Clip(expected)}\nactual:   {Clip(actual)}");
    }

    private static string Clip(JsonNode? node)
    {
        var text = node?.ToJsonString() ?? "null";
        return text.Length > 1500 ? text[..1500] + "..." : text;
    }

    [Theory, MemberData(nameof(AllRepos))]
    public void Nodes_MatchTheGoldenInIdOrderAndEveryField(string repo)
    {
        var graph = Fixtures.GraphOf(repo);

        var actual = Fixtures.ToJson(graph.NodeList);

        AssertSame(Fixtures.Expected(repo)["nodes"], actual, $"{repo} nodes");
    }

    [Theory, MemberData(nameof(AllRepos))]
    public void Digest_MatchesTheGoldenUnderDefaultAndTightCaps(string repo)
    {
        var graph = Fixtures.GraphOf(repo);
        var expected = Fixtures.Expected(repo);
        var tight = new DigestCaps
        {
            MaxCalleesPerSymbol = 1, MaxCallersPerSymbol = 1, MaxImportsPerFile = 1, MaxDetailedFiles = 2,
        };

        var actualDefault = DependencyDigest.Build(graph);
        var actualTight = DependencyDigest.Build(graph, tight);
        actualDefault.Remove("generated_at");
        actualTight.Remove("generated_at");

        AssertSame(expected["digest"], actualDefault, $"{repo} digest");
        AssertSame(expected["digest_tight"], actualTight, $"{repo} digest (tight caps)");
    }

    [Theory, MemberData(nameof(AllRepos))]
    public void Clusters_MatchTheGolden(string repo)
    {
        var graph = Fixtures.GraphOf(repo);

        var result = Clustering.Build(graph, Fixtures.ResolverOf(repo));

        var actual = new JsonObject
        {
            ["components"] = Fixtures.ToJson(result.Components),
            ["containers"] = Fixtures.ToJson(result.Containers),
            ["component_edges"] = Fixtures.ToJson(result.ComponentEdges),
            ["container_edges"] = Fixtures.ToJson(result.ContainerEdges),
            ["undetermined_files"] = Fixtures.ToJson(result.UndeterminedFiles),
            ["file_edge_weights"] = new JsonArray(result.FileEdgeWeights
                .OrderBy(w => w.Key.Item1, StringComparer.Ordinal).ThenBy(w => w.Key.Item2, StringComparer.Ordinal)
                .Select(w => (JsonNode)new JsonArray(w.Key.Item1, w.Key.Item2, w.Value)).ToArray()),
            ["undetermined_candidates"] = new JsonObject(result.UndeterminedFiles.Select(f =>
                KeyValuePair.Create(f, (JsonNode?)Fixtures.ToJson(Clustering.UndeterminedCandidates(f, result))))),
        };
        AssertSame(Fixtures.Expected(repo)["clusters"], actual, $"{repo} clusters");
    }

    [Theory]
    [InlineData("append_method")]
    [InlineData("delete_file")]
    public void ReanalyzeDiff_MatchesTheEngineForTheEditScenarios(string scenarioName)
    {
        var scenario = Fixtures.Scenario(scenarioName);
        var before = Fixtures.Build(AnalysisInputReader.Parse(scenario["before"]!.ToJsonString()));
        var after = Fixtures.Build(AnalysisInputReader.Parse(scenario["after"]!.ToJsonString()));

        var diff = GraphDiffer.Diff(before, after);

        var expected = scenario["diff"]!;
        AssertSame(expected["added_node_ids"], Fixtures.ToJson(diff.AddedNodeIds), "added");
        AssertSame(expected["removed_node_ids"], Fixtures.ToJson(diff.RemovedNodeIds), "removed");
        AssertSame(expected["reparented_node_ids"],
            new JsonArray(diff.ReparentedNodeIds.Select(r => (JsonNode)new JsonArray(
                r.NodeId, Fixtures.ToJson(r.OldParentIds), Fixtures.ToJson(r.NewParentIds))).ToArray()),
            "reparented");
    }
}
