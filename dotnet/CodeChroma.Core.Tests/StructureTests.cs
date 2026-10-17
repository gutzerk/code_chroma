namespace CodeChroma.Core.Tests;

public sealed record StructureCase(string Name, StructureOptions Options, string[] TopLevelIds, int? FlatCount, bool Truncated, int Depth)
{
    public override string ToString() => Name;
}

public class StructureTests
{
    private static readonly Lazy<Graph> Sample = new(() => Fixtures.GraphOf("sample_repo"));

    private static IEnumerable<StructureEntry> Flatten(IEnumerable<StructureEntry> entries) =>
        entries.SelectMany(e => new[] { e }.Concat(Flatten(e.Children ?? [])));

    private static readonly string[] AllSystems = ["dir::billing", "dir::shared", "dir::users", "dir::web"];

    public static TheoryData<StructureCase> Cases() => new()
    {
        new("default lists every top-level entry", new(), AllSystems, null, true, 2),
        new("depth 1 cuts the subtree", new(Depth: 1), AllSystems, null, true, 1),
        new("root narrows to one subtree", new("dir::billing", 1),
            ["dir::billing/models", "component::billing/reporter.go", "component::billing/service.py"], null, true, 1),
        new("max_children caps a wide level", new(MaxChildren: 1), ["dir::billing"], null, true, 2),
        new("max_nodes bounds the whole payload", new(Depth: 5, MaxNodes: 3), ["dir::billing", "dir::shared", "dir::users"], 3, true, 5),
        new("depth is clamped to the hard maximum", new(Depth: 99), AllSystems, null, false, 5),
    };

    [Theory, MemberData(nameof(Cases))]
    public void Build_HonoursDepthChildAndNodeBudgetsAndFlagsWhatItCut(StructureCase c)
    {
        var result = StructureBuilder.Build(Sample.Value, c.Options);

        Assert.Equal(c.TopLevelIds, result.Nodes.Select(n => n.NodeId));
        Assert.Equal(c.Truncated, result.Truncated);
        Assert.Equal(c.Depth, result.Depth);
        if (c.FlatCount is { } count) Assert.Equal(count, Flatten(result.Nodes).Count());
    }

    [Fact]
    public void ADepthCut_MarksTheSubtreeTruncatedAndKeepsItsChildCount()
    {
        var result = StructureBuilder.Build(Sample.Value, new(Depth: 1));

        var billing = result.Nodes.Single(n => n.Name == "billing");
        Assert.True(billing.Truncated);
        Assert.Equal(3, billing.ChildCount);
        Assert.Null(billing.Children);
    }

    [Fact]
    public void Entries_SortFoldersBeforeFilesCarryRepoRelativePathsAndNeverListSymbolLevels()
    {
        var result = StructureBuilder.Build(Sample.Value, new(Depth: 5));

        var billing = result.Nodes.Single(n => n.Name == "billing");
        Assert.Equal(["billing/models", "billing/reporter.go", "billing/service.py"], billing.Children!.Select(c => c.Path));
        Assert.Equal(["folder", "file", "file"], billing.Children!.Select(c => c.Level));
        var files = Flatten(result.Nodes).Where(e => e.Level == "file").ToList();
        Assert.NotEmpty(files);
        Assert.All(files, f => Assert.Null(f.Children));
    }

    [Theory]
    [InlineData("Billing module. It does more.", "Billing module.")]
    [InlineData("  One sentence only.  ", "One sentence only.")]
    [InlineData("No terminal period", "No terminal period.")]
    public void Summary_IsTheFirstSentenceOnlyAndCappedAtOneHundredSixtyCharacters(string text, string expected)
    {
        var graph = new Graph(
            [new HierarchyNode { Id = "dir::a", Name = "a", Level = HierarchyLevel.System, SourcePath = "a" }], [],
            new Dictionary<string, string> { ["dir::a"] = text });

        var entry = StructureBuilder.Build(graph).Nodes.Single();

        Assert.Equal(expected, entry.Summary);
        Assert.True(StructureBuilder.Build(Longest(graph)).Nodes.Single().Summary!.Length <= 160);
    }

    private static Graph Longest(Graph graph) =>
        new(graph.NodeList, [], new Dictionary<string, string> { ["dir::a"] = new string('x', 400) });

    [Fact]
    public void ANodeWithoutASummary_HasANullSummary()
    {
        var graph = new Graph([new HierarchyNode { Id = "dir::a", Name = "a", Level = HierarchyLevel.System }], []);

        Assert.Null(StructureBuilder.Build(graph).Nodes.Single().Summary);
    }

    [Fact]
    public void AnUnknownRoot_Throws()
    {
        Assert.Throws<UnknownRootException>(() => StructureBuilder.Build(Sample.Value, new("dir::nope")));
    }
}
