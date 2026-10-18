using System.Text.Json.Nodes;

namespace CodeChroma.Core.Tests;

public class DependencyDigestTests
{
    private static JsonObject FileEntry(JsonObject digest, string path) =>
        digest["files"]!.AsArray().Select(f => f!.AsObject()).Single(f => (string?)f["path"] == path);

    private static Graph GraphWithCalls(string file, string caller, string[] callees, int callerEnd = 20)
    {
        var module = Sym.Module(file);
        var symbols = new List<Symbol> { module, Sym.Func(file, caller, module.Id, 1, callerEnd, references: callees) };
        symbols.AddRange(callees.Select(c => Sym.Func(file, c, module.Id)));
        return Sym.GraphFrom([new FileSymbols(file, symbols)]);
    }

    [Fact]
    public void EveryParsedFile_AppearsWithItsComponentNodeId()
    {
        var graph = Fixtures.GraphOf("sample_repo");

        var digest = DependencyDigest.Build(graph);

        Assert.Equal("component::billing/service.py", (string?)FileEntry(digest, "billing/service.py")["node_id"]);
    }

    [Fact]
    public void ACrossFileCall_ShowsAsAClassCallsEntry()
    {
        var graph = Fixtures.GraphOf("sample_repo");

        var digest = DependencyDigest.Build(graph);

        var billing = FileEntry(digest, "billing/service.py")["classes"]!.AsArray()
            .Single(c => (string?)c!["name"] == "BillingService")!;
        Assert.Contains("shared/text_utils.py::function::slugify", billing["calls"]!.AsArray().Select(c => (string?)c));
    }

    [Fact]
    public void FanOutBeyondTheCalleeCap_IsTruncatedWithAnOverflowCount()
    {
        var callees = Enumerable.Range(0, 20).Select(i => $"callee_{i}").ToArray();
        var graph = GraphWithCalls("big.py", "caller", callees);
        var caps = new DigestCaps();

        var digest = DependencyDigest.Build(graph, caps);

        var entry = FileEntry(digest, "big.py")["functions"]!.AsArray().Single(f => (string?)f!["name"] == "caller")!;
        Assert.Equal(caps.MaxCalleesPerSymbol, entry["calls"]!.AsArray().Count);
        Assert.Equal(20 - caps.MaxCalleesPerSymbol, (int)entry["calls_overflow"]!);
    }

    [Fact]
    public void ATrivialNoCallFunction_IsOmittedAndCounted()
    {
        var module = Sym.Module("small.py");
        var graph = Sym.GraphFrom([new("small.py", [module, Sym.Func("small.py", "trivial", module.Id, 5, 5)])]);

        var digest = DependencyDigest.Build(graph);

        var entry = FileEntry(digest, "small.py");
        Assert.Empty(entry["functions"]!.AsArray());
        Assert.Equal(1, (int)entry["functions_omitted"]!);
    }

    [Fact]
    public void ALowDetailedFileCap_MarksTheDigestTruncated()
    {
        var graph = Fixtures.GraphOf("sample_repo");

        var digest = DependencyDigest.Build(graph, new DigestCaps { MaxDetailedFiles = 1 });

        Assert.True((bool)digest["truncated"]!);
        Assert.True((int)digest["files_omitted"]! >= 1);
        Assert.Contains(digest["files"]!.AsArray(), f => f!["detail_omitted"] is not null);
    }

    [Fact]
    public void DigestPath_LivesUnderTheRepoDotCodechromaFolder()
    {
        var path = DependencyDigest.PathFor(Path.Combine("repo", "x"));

        Assert.Equal(Path.Combine("repo", "x", ".codechroma", "dependency-digest.json"), path);
    }

    [Fact]
    public void ADigestWrittenToDisk_LoadsBackEqual()
    {
        using var temp = new TempDir();
        var digest = DependencyDigest.Build(Fixtures.GraphOf("sample_repo"));

        DependencyDigest.Write(temp.Path, digest);
        var loaded = DependencyDigest.Load(temp.Path);

        Assert.True(JsonNode.DeepEquals(digest, loaded));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("{not json")]
    public void LoadingAMissingOrMalformedDigest_YieldsAnEmptyObject(string? content)
    {
        using var temp = new TempDir();
        if (content is not null)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(DependencyDigest.PathFor(temp.Path))!);
            File.WriteAllText(DependencyDigest.PathFor(temp.Path), content);
        }

        var loaded = DependencyDigest.Load(temp.Path);

        Assert.Empty(loaded);
    }

    private static DependencyIndex Chain(int length)
    {
        var nodes = Enumerable.Range(0, length).Select(i => new HierarchyNode
        {
            Id = $"n{i}", Name = $"n{i}", Level = HierarchyLevel.Function,
            DependsOnIds = i + 1 < length ? [$"n{i + 1}"] : [],
        }).Append(new HierarchyNode { Id = "island", Name = "island", Level = HierarchyLevel.Function }).ToList();
        return new DependencyIndex(new Graph(nodes, []));
    }

    [Theory]
    [InlineData("n0", "n0", "n0")]
    [InlineData("n0", "n2", "n0>n1>n2")]
    [InlineData("n2", "n0", "n2>n1>n0")]
    [InlineData("n0", "n12", "n0>n1>n2>n3>n4>n5>n6>n7>n8>n9>n10>n11>n12")]
    [InlineData("n0", "n13", null)]
    [InlineData("n0", "island", null)]
    [InlineData("n0", "missing", null)]
    public void FindRoute_PrefersCalleesThenCallersAndStopsAtTheHopCap(string from, string to, string? expected)
    {
        var index = Chain(14);

        var route = index.FindRoute(from, to);

        Assert.Equal(expected, route is null ? null : string.Join(">", route));
    }

    [Fact]
    public void DependentsAreSortedAndDependenciesDropUnknownNodes()
    {
        var nodes = new List<HierarchyNode>
        {
            new() { Id = "a", Name = "a", Level = HierarchyLevel.Function, DependsOnIds = ["c", "ghost"] },
            new() { Id = "b", Name = "b", Level = HierarchyLevel.Function, DependsOnIds = ["c"] },
            new() { Id = "c", Name = "c", Level = HierarchyLevel.Function },
        };
        var index = new DependencyIndex(new Graph(nodes, []));

        Assert.Equal(["a", "b"], index.DependentsOf("c"));
        Assert.Equal(["c"], index.DependenciesOf("a"));
        Assert.Equal(new[] { ("a", "c"), ("b", "c") }, index.Edges());
    }
}

public sealed class TempDir : IDisposable
{
    public string Path { get; } = Directory.CreateTempSubdirectory("cc-core-").FullName;

    public void Dispose() => Directory.Delete(Path, recursive: true);
}
