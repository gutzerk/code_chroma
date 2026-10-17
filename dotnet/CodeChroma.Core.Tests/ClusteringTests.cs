using System.Text.Json;

namespace CodeChroma.Core.Tests;

public class ClusteringTests
{
    private static readonly Lazy<(Graph Graph, ClusterResult Result)> Fixture = new(() =>
    {
        var graph = Fixtures.GraphOf("wiki_general_clustering");
        return (graph, Clustering.Build(graph, Fixtures.ResolverOf("wiki_general_clustering")));
    });

    private static ClusterResult Result => Fixture.Value.Result;

    private static ComponentCluster ComponentWith(string file) => Result.Components.Single(c => c.Files.Contains(file));

    [Theory]
    [InlineData("component", "billing/service.py", "billing/invoice.py")] // folder default
    [InlineData("component", "misc/helper.py", "billing/service.py")] // call majority
    [InlineData("component", "solo_a/a.py", "solo_b/b.py")] // aggregate merge of isolated files
    [InlineData("component", "consts/values.py", "billing/service.py")] // import fallback
    [InlineData("container", "billing/service.py", "billing/reports/summary.py")] // shared top-level dir
    public void ResolutionChain_PlacesTwoFilesInTheSameGroup(string level, string fileA, string fileB)
    {
        var (a, b) = (ComponentWith(fileA), ComponentWith(fileB));

        var (idA, idB) = level == "component" ? (a.Id, b.Id) : (a.ContainerId, b.ContainerId);

        Assert.Equal(idA, idB);
    }

    [Fact]
    public void AFullyDisconnectedFile_IsUndetermined()
    {
        Assert.Equal(["orphan/isolated.py"], Result.UndeterminedFiles);
    }

    [Fact]
    public void AnUndeterminedFile_GetsRealCandidateComponentsNotCode()
    {
        var candidates = Clustering.UndeterminedCandidates("orphan/isolated.py", Result);

        Assert.Equal(3, candidates.Count);
        var known = Result.Components.Select(c => c.Id).ToHashSet();
        Assert.All(candidates, c =>
        {
            Assert.Contains(c.Id, known);
            Assert.NotEmpty(c.Files);
        });
    }

    [Fact]
    public void ADisconnectedComponent_BecomesItsOwnSoloContainer()
    {
        var shipping = ComponentWith("shipping/service.py");

        var container = Result.Containers.Single(c => c.Id == shipping.ContainerId);

        Assert.Equal([shipping.Id], container.ComponentIds);
    }

    [Theory]
    [InlineData(".github/workflows/ci.yml", true)]
    [InlineData(".specify/memory/constitution.md", true)]
    [InlineData(".gremlins.yaml", true)]
    [InlineData("a/testdata/x.yaml", true)]
    [InlineData("misc/testdata/fixture.yaml", true)]
    [InlineData("billing/service.py", false)]
    [InlineData("gateway-orchestration/tools/mock-openai-v1/main.go", false)]
    [InlineData("deploy/config.yaml", false)]
    public void IsInfraPath_FlagsCiAndFixturePathsButNotRealSource(string path, bool infra)
    {
        Assert.Equal(infra, Clustering.IsInfraPath(path));
    }

    [Theory]
    [InlineData(".github/workflows/ci.yml")]
    [InlineData(".gremlins.yaml")]
    [InlineData("misc/testdata/fixture.yaml")]
    public void InfraFiles_NeverReachAComponentOrTheUndeterminedList(string path)
    {
        var placed = Result.Components.SelectMany(c => c.Files).Concat(Result.UndeterminedFiles);

        Assert.DoesNotContain(path, placed);
    }

    [Fact]
    public void EveryComponentHasFilesAndARealContainerAndEdgesAreCrossGroup()
    {
        var containerIds = Result.Containers.Select(c => c.Id).ToHashSet();

        Assert.All(Result.Components, c =>
        {
            Assert.NotEmpty(c.Files);
            Assert.Contains(c.ContainerId, containerIds);
        });
        Assert.All(Result.ComponentEdges.Concat(Result.ContainerEdges), e =>
        {
            Assert.True(e.Count >= 1);
            Assert.NotEqual(e.FromId, e.ToId);
        });
    }

    [Fact]
    public void RebuildingFromTheSameInput_IsReproducible()
    {
        var graph = Fixture.Value.Graph;
        var resolver = Fixtures.ResolverOf("wiki_general_clustering");

        var first = JsonSerializer.Serialize(Clustering.Build(graph, resolver).Components, WireJson.Options);
        var second = JsonSerializer.Serialize(Clustering.Build(graph, resolver).Components, WireJson.Options);

        Assert.Equal(first, second);
    }

    [Theory]
    [InlineData("", null)]
    [InlineData("a=3", "a")]
    [InlineData("a=2,b=2", null)]
    [InlineData("a=1,b=3,c=2", "b")]
    public void PluralityWinner_IsTheStrictTopVoteGetterElseNull(string votes, string? expected)
    {
        Dictionary<string, int> tally = votes == "" ? [] : votes.Split(',').Select(v => v.Split('=')).ToDictionary(p => p[0], p => int.Parse(p[1]));

        Assert.Equal(expected, Clustering.PluralityWinner(tally));
    }
}
