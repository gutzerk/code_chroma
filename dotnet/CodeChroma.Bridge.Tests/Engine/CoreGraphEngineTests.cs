using System.Text.Json.Nodes;
using CodeChroma.Bridge.Engine;
using CodeChroma.Bridge.Tests.Contract;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Core;

namespace CodeChroma.Bridge.Tests.Engine;

/// <summary>A fact that runs only when CODECHROMA_PYTHON names an interpreter with codechroma importable.</summary>
public sealed class RequiresPythonFactAttribute : FactAttribute
{
    public RequiresPythonFactAttribute()
    {
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable(PythonAnalysisExporter.PythonEnvVar)))
            Skip = $"set {PythonAnalysisExporter.PythonEnvVar} to run the Python-analyzer integration";
    }
}

public class CoreGraphEngineTests
{
    private static readonly string GoldenDir = Path.Combine(ContractCases.FixtureDir, "..", "graph_golden");

    private static AnalysisInput SampleInput() => AnalysisInputReader.Load(Path.Combine(GoldenDir, "sample_repo.input.json"));

    private static JsonArray ExpectedNodes() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(GoldenDir, "sample_repo.expected.json")))!["nodes"]!.AsArray();

    [Fact]
    public void Every_golden_node_is_served_with_its_parents_and_dependencies()
    {
        var engine = new CoreGraphEngine(SampleInput());
        var expected = ExpectedNodes();

        var actual = expected.Select(n => engine.GetNode(n!["id"]!.GetValue<string>())).ToList();

        Assert.All(actual, node => Assert.NotNull(node));
        Assert.Equal(
            expected.Select(n => n!["parent_ids"]!.AsArray().Select(p => p!.GetValue<string>()).ToArray()),
            actual.Select(n => n!.ParentIds.ToArray()));
        Assert.Equal(
            expected.Select(n => n!["depends_on_ids"]!.AsArray().Select(p => p!.GetValue<string>()).ToArray()),
            actual.Select(n => n!.DependsOnIds.ToArray()));
    }

    [Fact]
    public void Root_children_come_back_in_builder_order()
    {
        var engine = new CoreGraphEngine(SampleInput());
        var wanted = ExpectedNodes().Where(n => n!["parent_ids"]!.AsArray().Count == 0).Select(n => n!["id"]!.GetValue<string>());

        var roots = engine.GetChildren(IGraphEngine.RootSentinel).Select(n => n.Id);

        Assert.Equal(wanted, roots);
    }

    [Fact]
    public void A_function_resolves_to_its_symbol_lines_and_summary()
    {
        var engine = new CoreGraphEngine(SampleInput());
        var function = ExpectedNodes().Select(n => n!.AsObject()).First(n => n["level"]!.GetValue<string>() == "function");
        var id = function["id"]!.GetValue<string>();

        var symbol = engine.GetSymbol(id);

        Assert.NotNull(symbol);
        Assert.True(symbol.EndLine >= symbol.StartLine);
        Assert.False(string.IsNullOrEmpty(engine.SummaryText(id)));
    }

    [Fact]
    public void Reanalyze_applies_the_exporters_delta_and_drops_removed_files()
    {
        var exporter = new FakeExporter(new AnalysisDelta([], ["web/widget.ts"]));
        var engine = new CoreGraphEngine(SampleInput(), exporter);
        var before = ExpectedNodes().Count(n => n!["source_path"]?.GetValue<string>() == "web/widget.ts");

        engine.Reanalyze(["web/widget.ts"]);

        Assert.True(before > 0);
        Assert.Equal(["web/widget.ts"], exporter.Requested);
        Assert.Null(engine.GetNode("web/widget.ts::module::web.widget") ?? engine.GetNode("web/widget.ts"));
    }

    [RequiresPythonFact]
    public void The_python_exporter_produces_the_same_graph_as_the_golden_input()
    {
        var root = Path.GetFullPath(Path.Combine(ContractCases.FixtureDir, "..", "sample_repo"));

        var engine = new CoreGraphEngine(root, new PythonAnalysisExporter());

        var expected = ExpectedNodes().Select(n => n!["id"]!.GetValue<string>()).Order().ToArray();
        var actual = Collect(engine).Order().ToArray();
        Assert.Equal(expected, actual);
    }

    private static IEnumerable<string> Collect(IGraphEngine engine)
    {
        var queue = new Queue<GraphNode>(engine.GetChildren(IGraphEngine.RootSentinel));
        var seen = new HashSet<string>();
        while (queue.Count > 0)
        {
            var node = queue.Dequeue();
            if (!seen.Add(node.Id)) continue;
            foreach (var child in engine.GetChildren(node.Id)) queue.Enqueue(child);
        }
        return seen;
    }

    private sealed class FakeExporter(AnalysisDelta delta) : IAnalysisExporter
    {
        public List<string> Requested { get; } = [];

        public AnalysisInput Full(string root) => throw new NotSupportedException();

        public AnalysisDelta Delta(string root, IReadOnlyList<string> changedPaths)
        {
            Requested.AddRange(changedPaths);
            return delta;
        }
    }
}
