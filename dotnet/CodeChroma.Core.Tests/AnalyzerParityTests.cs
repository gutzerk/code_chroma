using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Core.Analyzers;

namespace CodeChroma.Core.Tests;

/// <summary>Skipped unless CODECHROMA_PYTHON names an interpreter that can run `python -m codechroma.analysis_export`.</summary>
public sealed class PythonOracleFactAttribute : FactAttribute
{
    public PythonOracleFactAttribute()
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("CODECHROMA_PYTHON")))
            Skip = "set CODECHROMA_PYTHON (and PYTHONPATH to the repo's src) to compare against the live Python analyzers";
    }
}

/// <summary>The C# analyzers against the Python-exported analysis input, per fixture repo and per language.</summary>
public class AnalyzerParityTests
{
    private static readonly AnalysisExporter Exporter = new();

    private static string FixtureRepo(string repo) => Path.Combine(Fixtures.FixturesDir, repo);

    private static JsonNode Golden(string repo) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures.GoldenDir, $"{repo}.input.json")))!;

    private static string LanguageOf(string path) => Exporter.Registry.ForFile(path)?.Language ?? "none";

    public static TheoryData<string, string> RepoLanguages()
    {
        var data = new TheoryData<string, string>();
        foreach (var repo in Fixtures.Repos)
        {
            var languages = Golden(repo)["files"]!.AsArray().Select(f => LanguageOf(f!["path"]!.GetValue<string>())).Distinct().Order();
            foreach (var language in languages) data.Add(repo, language);
        }
        return data;
    }

    private static string Clip(JsonNode? node)
    {
        var text = node?.ToJsonString() ?? "null";
        return text.Length > 1200 ? text[..1200] + "..." : text;
    }

    private static void AssertSame(JsonNode? expected, JsonNode? actual, string what)
    {
        if (JsonNode.DeepEquals(expected, actual)) return;
        Assert.Fail($"{what} differs from the Python export.\nexpected: {Clip(expected)}\nactual:   {Clip(actual)}");
    }

    private static void AssertFilesSame(JsonArray expected, JsonArray actual, string what)
    {
        Assert.Equal(expected.Select(f => f!["path"]!.GetValue<string>()), actual.Select(f => f!["path"]!.GetValue<string>()));
        var bad = Enumerable.Range(0, expected.Count).Where(i => !JsonNode.DeepEquals(expected[i], actual[i])).ToList();
        if (bad.Count == 0) return;
        var paths = string.Join(", ", bad.Take(15).Select(i => expected[i]!["path"]!.GetValue<string>()));
        Assert.Fail($"{what}: {bad.Count} of {expected.Count} files differ from the Python export: {paths}"
            + $"\nfirst: expected {Clip(expected[bad[0]])}\n       actual   {Clip(actual[bad[0]])}");
    }

    [Theory, MemberData(nameof(Fixtures.RepoDataForAnalyzers), MemberType = typeof(Fixtures))]
    public void FileList_MatchesThePythonScan(string repo)
    {
        var expected = Golden(repo)["files"]!.AsArray().Select(f => f!["path"]!.GetValue<string>()).ToList();

        var actual = Exporter.Full(FixtureRepo(repo)).Files.Select(f => f.Path).ToList();

        Assert.Equal(expected, actual);
    }

    [Theory, MemberData(nameof(RepoLanguages))]
    public void Symbols_MatchThePythonAnalyzer_PerLanguage(string repo, string language)
    {
        var expected = new JsonArray(Golden(repo)["files"]!.AsArray()
            .Where(f => LanguageOf(f!["path"]!.GetValue<string>()) == language).Select(f => f!.DeepClone()).ToArray());

        var actual = Fixtures.ToJson(Exporter.Full(FixtureRepo(repo)).Files
            .Where(f => LanguageOf(f.Path) == language).ToList()).AsArray();

        AssertFilesSame(expected, actual, $"{repo}/{language}");
    }

    [Theory, MemberData(nameof(Fixtures.RepoDataForAnalyzers), MemberType = typeof(Fixtures))]
    public void ImportResolutions_MatchThePythonAnalyzers(string repo)
    {
        var expected = Golden(repo)["import_resolutions"];

        var actual = Fixtures.ToJson(Exporter.Full(FixtureRepo(repo)).ImportResolutions);

        AssertSame(expected, actual, $"{repo} import_resolutions");
    }

    [Theory, MemberData(nameof(Fixtures.RepoDataForAnalyzers), MemberType = typeof(Fixtures))]
    public void Summaries_MatchTheOfflineSummarizer(string repo)
    {
        var expected = Golden(repo)["summaries"];

        var actual = Fixtures.ToJson(Exporter.Full(FixtureRepo(repo)).Summaries);

        AssertSame(expected, actual, $"{repo} summaries");
    }

    [Theory, MemberData(nameof(Fixtures.RepoDataForAnalyzers), MemberType = typeof(Fixtures))]
    public void Graph_FromTheCSharpAnalyzers_MatchesTheNodeGolden(string repo)
    {
        var input = Exporter.Full(FixtureRepo(repo));

        var graph = Fixtures.Build(input);

        AssertSame(Fixtures.Expected(repo)["nodes"], Fixtures.ToJson(graph.NodeList), $"{repo} nodes");
    }

    [Fact]
    public void Delta_ReportsMissingFilesAsRemovedAndParsesTheRest()
    {
        var repo = FixtureRepo("sample_repo");

        var delta = Exporter.Delta(repo, ["billing/service.py", "gone/nowhere.py"]);

        Assert.Equal(["gone/nowhere.py"], delta.Removed);
        Assert.Equal(["billing/service.py"], delta.Changed.Select(c => c.Path));
        Assert.NotEmpty(delta.Changed[0].Symbols!);
    }

    [Fact]
    public void UnparseableOrUnknownFiles_AreNullEntries()
    {
        var root = Directory.CreateTempSubdirectory().FullName;
        File.WriteAllText(Path.Combine(root, "notes.unknown"), "hello");

        var input = Exporter.Full(root);

        Assert.Null(Assert.Single(input.Files).Symbols);
    }

    /// <summary>Runs `python -m codechroma.analysis_export` on a directory and diffs every file, import resolution and summary.</summary>
    [PythonOracleFact]
    public void LiveOracle_RepoSource_MatchesPythonForEveryFile()
    {
        var target = Environment.GetEnvironmentVariable("CODECHROMA_ORACLE_REPO") ?? FindRepoRoot();
        var python = Environment.GetEnvironmentVariable("CODECHROMA_PYTHON")!;
        var expected = JsonNode.Parse(RunPython(python, target))!;

        var actualInput = Exporter.Full(target);
        var actual = Fixtures.ToJson(actualInput);

        // Languages without a C# analyzer yet are compared only when CODECHROMA_ORACLE_STRICT=1.
        var strict = Environment.GetEnvironmentVariable("CODECHROMA_ORACLE_STRICT") == "1";
        bool Supported(JsonNode? f) => strict || Exporter.Registry.ForFile(f!["path"]!.GetValue<string>()) is not null;
        var expectedFiles = new JsonArray(expected["files"]!.AsArray().Where(Supported).Select(f => f!.DeepClone()).ToArray());
        var actualFiles = new JsonArray(actual["files"]!.AsArray().Where(Supported).Select(f => f!.DeepClone()).ToArray());
        AssertFilesSame(expectedFiles, actualFiles, "live oracle");
        if (!strict) return;
        AssertSame(expected["import_resolutions"], actual["import_resolutions"], "live oracle import_resolutions");
        AssertSame(expected["summaries"], actual["summaries"], "live oracle summaries");
    }

    private static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(Fixtures.FixturesDir);
        return dir.Parent!.Parent!.FullName;
    }

    private static string RunPython(string python, string root)
    {
        var info = new ProcessStartInfo(python)
        {
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, WorkingDirectory = root,
        };
        foreach (var arg in new[] { "-m", "codechroma.analysis_export", root }) info.ArgumentList.Add(arg);
        info.Environment["PYTHONIOENCODING"] = "utf-8";
        using var process = Process.Start(info)!;
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        process.WaitForExit();
        if (process.ExitCode != 0) throw new InvalidOperationException(stderr.GetAwaiter().GetResult());
        return stdout.GetAwaiter().GetResult();
    }
}
