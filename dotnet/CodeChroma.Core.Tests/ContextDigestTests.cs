using System.Text.Json.Nodes;

namespace CodeChroma.Core.Tests;

public class ContextDigestTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("ctxdigest").FullName;

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private static Graph ImportingGraph(params string[] dotted)
    {
        var imports = dotted.Select((d, i) => (Key: $"a{i}", Value: d)).ToDictionary(p => p.Key, p => p.Value);
        var module = Sym.Module("m.py", imports);
        return Sym.GraphFrom([new FileSymbols("m.py", [module])]);
    }

    private JsonObject BuildFor(Graph graph) => ContextDigest.Build(graph, _root);

    public static TheoryData<string> Repos() => Fixtures.RepoData();

    [Theory, MemberData(nameof(Repos))]
    public void Digest_MatchesTheGoldenExceptTheThrowawayRepoName(string repo)
    {
        var graph = Fixtures.GraphOf(repo);
        var fixtureRoot = Path.Combine(Fixtures.FixturesDir, repo);

        var actual = ContextDigest.Build(graph, fixtureRoot);

        actual.Remove("repo_name");
        Assert.True(JsonNode.DeepEquals(Fixtures.Expected(repo)["context_digest"], actual), actual.ToJsonString());
    }

    [Fact]
    public void RepoName_IsTheRootFolderName()
    {
        var graph = ImportingGraph();

        var digest = BuildFor(graph);

        Assert.Equal(Path.GetFileName(_root), (string?)digest["repo_name"]);
    }

    [Fact]
    public void ExternalRoots_SkipStdlibAndRepoFoldersAndRankByCount()
    {
        var graph = ImportingGraph("requests.sessions", "requests", "flask", "os.path");

        var roots = BuildFor(graph)["external_import_roots"]!.AsArray();

        Assert.Equal(["requests:2", "flask:1"], roots.Select(r => $"{r!["root"]}:{r["count"]}"));
    }

    [Fact]
    public void DeclaredDependencies_ReadPyprojectPackageJsonAndGoMod()
    {
        File.WriteAllText(Path.Combine(_root, "pyproject.toml"), "[project]\ndependencies = [\"fastapi (>=0.1)\", \"httpx[http2]>=0.2\"]\n");
        File.WriteAllText(Path.Combine(_root, "package.json"), "{\"dependencies\": {\"react\": \"^18\"}}");
        File.WriteAllText(Path.Combine(_root, "go.mod"),
            "module x\n\nrequire (\n\tgithub.com/redis/go-redis/v9 v9.0.0 // indirect\n\tgolang.org/x/sync v0.1.0\n)\nrequire github.com/a/b v1.0.0\n");

        var names = BuildFor(ImportingGraph())["declared_dependencies"]!.AsArray().Select(n => (string?)n);

        Assert.Equal(["fastapi", "httpx", "react", "github.com/redis/go-redis", "golang.org/x/sync", "github.com/a/b"], names);
    }

    [Fact]
    public void MalformedManifests_AreIgnored()
    {
        File.WriteAllText(Path.Combine(_root, "pyproject.toml"), "[[[ not toml");
        File.WriteAllText(Path.Combine(_root, "package.json"), "{nope");

        var names = BuildFor(ImportingGraph())["declared_dependencies"]!.AsArray();

        Assert.Empty(names);
    }

    [Fact]
    public void ReadmeExcerpt_IsCappedAndPrefersReadmeMd()
    {
        File.WriteAllText(Path.Combine(_root, "README.md"), new string('x', 2000));
        File.WriteAllText(Path.Combine(_root, "README.txt"), "ignored");

        var excerpt = (string?)BuildFor(ImportingGraph())["readme_excerpt"];

        Assert.Equal(ContextDigest.ReadmeExcerptChars, excerpt!.Length);
    }

    [Fact]
    public void ReadmeExcerpt_IsNullWithoutAReadme()
    {
        var digest = BuildFor(ImportingGraph());

        Assert.Null(digest["readme_excerpt"]);
    }
}
