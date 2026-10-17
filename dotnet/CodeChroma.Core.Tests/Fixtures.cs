using System.Text.Json;
using System.Text.Json.Nodes;

namespace CodeChroma.Core.Tests;

/// <summary>Locates the shared repo fixtures and the Python-exported goldens (tests/fixtures/graph_golden).</summary>
public static class Fixtures
{
    public static readonly string[] Repos =
    [
        "sample_repo", "polyglot_repo", "c0_import_resolution",
        "wiki_general_clustering", "yaml_repo", "repo_scan_exclusions",
    ];

    public static TheoryData<string> RepoData()
    {
        var data = new TheoryData<string>();
        foreach (var repo in Repos) data.Add(repo);
        return data;
    }

    public static readonly string FixturesDir = FindFixturesDir();
    public static readonly string GoldenDir = Path.Combine(FixturesDir, "graph_golden");

    private static string FindFixturesDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, "tests", "fixtures", "graph_golden");
            if (Directory.Exists(candidate)) return Path.Combine(dir.FullName, "tests", "fixtures");
            dir = dir.Parent;
        }
        throw new DirectoryNotFoundException("tests/fixtures/graph_golden not found above " + AppContext.BaseDirectory);
    }

    public static AnalysisInput Input(string repo) =>
        AnalysisInputReader.Load(Path.Combine(GoldenDir, $"{repo}.input.json"));

    public static JsonNode Expected(string repo) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(GoldenDir, $"{repo}.expected.json")))!;

    public static JsonNode Scenario(string name) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(GoldenDir, $"sample_repo.reanalyze-{name}.json")))!;

    public static Graph Build(AnalysisInput input)
    {
        var built = GraphBuilder.Build(input.Files, new TableImportResolver(input.ImportResolutions));
        return new Graph(built.Nodes, built.Symbols, input.Summaries);
    }

    public static Graph GraphOf(string repo) => Build(Input(repo));

    public static IImportResolver ResolverOf(string repo) => new TableImportResolver(Input(repo).ImportResolutions);

    public static JsonNode ToJson<T>(T value) => JsonSerializer.SerializeToNode(value, WireJson.Options)!;
}

/// <summary>Terse hand-built symbols and graphs for the tests that need no fixture repo.</summary>
public static class Sym
{
    public static Symbol Module(string file, IReadOnlyDictionary<string, string>? imports = null) => new()
    {
        Id = $"{file}::module::mod", FilePath = file, Kind = SymbolKind.Module, Name = "mod",
        QualifiedName = "mod", StartLine = 1, EndLine = 1, Language = "python",
        Imports = imports ?? new Dictionary<string, string>(),
    };

    public static Symbol Func(
        string file, string name, string parentId, int start = 1, int end = 1,
        string[]? references = null, BodyStatement[]? body = null) => new()
    {
        Id = $"{file}::function::{name}", FilePath = file, Kind = SymbolKind.Function, Name = name,
        QualifiedName = name, StartLine = start, EndLine = end, Language = "python",
        ParentSymbolId = parentId, References = references ?? [], BodyStatements = body ?? [],
    };

    public static Symbol Class(string file, string name, string parentId) => new()
    {
        Id = $"{file}::class::{name}", FilePath = file, Kind = SymbolKind.Class, Name = name,
        QualifiedName = name, StartLine = 1, EndLine = 10, Language = "python", ParentSymbolId = parentId,
    };

    public static Graph GraphFrom(IEnumerable<FileSymbols> files, IImportResolver? resolver = null)
    {
        var built = GraphBuilder.Build(files.ToList(), resolver);
        return new Graph(built.Nodes, built.Symbols);
    }

    public static FileSymbols Parsed(string path, params Symbol[] symbols) => new(path, [Module(path), .. symbols]);
}
