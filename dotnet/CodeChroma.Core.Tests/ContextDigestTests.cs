using System.Text.Json.Nodes;

namespace CodeChroma.Core.Tests;

public class ContextDigestTests
{
    private const string Pyproject = "[project]\ndependencies = [\"fastapi (>=0.1,<0.2)\", \"anthropic\"]\n";
    private const string GoHeader = "module example.com/demo\n\n";

    public static TheoryData<string?, string?, string> DeclaredDependencyCases() => new()
    {
        { Pyproject, null, "fastapi,anthropic" },
        { null, GoHeader + "go 1.22\n\nrequire (\n\tgithub.com/lib/pq v1.10.9\n\tgithub.com/redis/go-redis/v9 v9.5.1 // indirect\n)\n", "github.com/lib/pq,github.com/redis/go-redis" },
        { null, GoHeader + "require(\n\tgithub.com/lib/pq v1.10.9\n)\n", "github.com/lib/pq" },
        { null, GoHeader + "require (\n\tgithub.com/lib/pq v1.10.9\n)\n\nrequire (\n\tgithub.com/redis/go-redis/v9 v9.5.1\n)\n", "github.com/lib/pq,github.com/redis/go-redis" },
        { null, GoHeader + "require (\n\tgithub.com/lib/pq v1.10.9\n", "github.com/lib/pq" },
        { null, GoHeader + "go 1.22\n\nrequire github.com/lib/pq v1.10.9\n", "github.com/lib/pq" },
        { null, "this is not a valid go.mod file at all {{{\n", "" },
        { Pyproject.Replace("\"anthropic\"", "\"httpx\""), GoHeader + "require github.com/lib/pq v1.10.9\n", "fastapi,httpx,github.com/lib/pq" },
        { null, null, "" },
    };

    [Theory, MemberData(nameof(DeclaredDependencyCases))]
    public void DeclaredDependencies_ComeFromPyprojectThenGoMod(string? pyproject, string? goMod, string expected)
    {
        using var repo = new TempDir();
        if (pyproject is not null) File.WriteAllText(Path.Combine(repo.Path, "pyproject.toml"), pyproject);
        if (goMod is not null) File.WriteAllText(Path.Combine(repo.Path, "go.mod"), goMod);

        var digest = ContextDigest.Build(Fixtures.GraphOf("sample_repo"), repo.Path);

        Assert.Equal(expected, string.Join(",", digest["declared_dependencies"]!.AsArray().Select(d => (string?)d)));
    }

    [Theory]
    [InlineData("# Sample Repo\n\nA demo billing/users app.", "# Sample Repo\n\nA demo billing/users app.")]
    [InlineData(null, null)]
    public void ReadmeExcerpt_ReadsTheRepoRootReadmeElseNull(string? readme, string? expected)
    {
        using var repo = new TempDir();
        if (readme is not null) File.WriteAllText(Path.Combine(repo.Path, "README.md"), readme);

        var digest = ContextDigest.Build(Fixtures.GraphOf("sample_repo"), repo.Path);

        Assert.Equal(expected, (string?)digest["readme_excerpt"]);
    }

    [Fact]
    public void Digest_CarriesOnlyTheFieldsC1ReadsAndTheRepoDirectoryName()
    {
        using var repo = new TempDir();

        var digest = ContextDigest.Build(Fixtures.GraphOf("sample_repo"), repo.Path);

        Assert.Equal(
            ["declared_dependencies", "external_import_roots", "readme_excerpt", "repo_name"],
            digest.Select(p => p.Key).Order());
        Assert.Equal(System.IO.Path.GetFileName(repo.Path), (string?)digest["repo_name"]);
    }

    [Fact]
    public void ExternalImportRoots_SkipStdlibAndRepoDirectoriesAndSortByCountDescending()
    {
        var module = Sym.Module("app/main.py", new Dictionary<string, string>
        {
            ["a"] = "requests.api", ["b"] = "requests.sessions", ["c"] = "numpy", ["d"] = "os.path", ["e"] = "app.util",
        });
        var graph = Sym.GraphFrom([new FileSymbols("app/main.py", [module])]);
        using var repo = new TempDir();

        var digest = ContextDigest.Build(graph, repo.Path);

        var roots = digest["external_import_roots"]!.AsArray().Select(r => $"{r!["root"]}:{r["count"]}");
        Assert.Equal(["requests:2", "numpy:1"], roots);
    }
}
