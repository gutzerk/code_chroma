using System.Text.Json.Nodes;

namespace CodeChroma.Core.Tests;

public class ContextDigestTests
{
    public static TheoryData<string> Repos() => Fixtures.RepoData();

    [Theory, MemberData(nameof(Repos))]
    public void Build_MatchesThePythonGolden(string repo)
    {
        var graph = Fixtures.GraphOf(repo);
        var root = Path.Combine(Fixtures.FixturesDir, repo);

        var actual = ContextDigest.Build(graph, root);
        actual.Remove("repo_name");

        Assert.True(JsonNode.DeepEquals(Fixtures.Expected(repo)["context_digest"], actual), actual.ToJsonString());
    }

    [Fact]
    public void ManifestsAndReadme_AreReadLikePython()
    {
        using var temp = new TempDir();
        File.WriteAllText(Path.Combine(temp.Path, "pyproject.toml"), "[project]\ndependencies = [\"fastapi (>=0.1)\", \"httpx[cli]>=2\"]\n");
        File.WriteAllText(Path.Combine(temp.Path, "package.json"), "{\"dependencies\": {\"react\": \"1\"}}");
        File.WriteAllText(Path.Combine(temp.Path, "go.mod"), "module x\nrequire (\n\tgithub.com/redis/go-redis/v9 v9.0.0 // c\n)\nrequire example.com/solo v1.0.0\n");
        File.WriteAllText(Path.Combine(temp.Path, "README.md"), "0123456789");
        var graph = new Graph([], []);

        var digest = ContextDigest.Build(graph, temp.Path, readmeChars: 4);

        Assert.Equal(["fastapi", "httpx", "react", "github.com/redis/go-redis", "example.com/solo"],
            digest["declared_dependencies"]!.AsArray().Select(d => (string?)d).ToArray());
        Assert.Equal("0123", (string?)digest["readme_excerpt"]);
    }

    [Fact]
    public void ExternalImportRoots_SkipStdlib_SortedByCount()
    {
        var module = Sym.Module("app/a.py", new Dictionary<string, string> { ["x"] = "yaml", ["y"] = "os.path", ["z"] = "requests.api", ["w"] = "requests" });
        var graph = Sym.GraphFrom([new FileSymbols("app/a.py", [module])]);

        var digest = ContextDigest.Build(graph, Path.GetTempPath());

        var roots = digest["external_import_roots"]!.AsArray().Select(r => ((string?)r!["root"], (int?)r["count"])).ToArray();
        Assert.Equal([("requests", 2), ("yaml", 1)], roots);
    }
}
