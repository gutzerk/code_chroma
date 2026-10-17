using CodeChroma.Bridge.Engine;
using Xunit;

namespace CodeChroma.Bridge.Tests.Engine;

/// <summary>The bridge's default engine analyzes with the C# analyzers: no Python interpreter anywhere.</summary>
public class NativeAnalysisExporterTests
{
    private static string FixtureRepo(string name)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "tests", "fixtures", name))) dir = dir.Parent;
        return Path.Combine(dir!.FullName, "tests", "fixtures", name);
    }

    private static List<string> AllNodeIds(IGraphEngine engine)
    {
        var seen = new List<string>();
        var queue = new Queue<GraphNode>(engine.GetChildren(IGraphEngine.RootSentinel));
        while (queue.Count > 0)
        {
            var node = queue.Dequeue();
            if (seen.Contains(node.Id)) continue;
            seen.Add(node.Id);
            foreach (var child in engine.GetChildren(node.Id)) queue.Enqueue(child);
        }
        return seen;
    }

    [Theory]
    [InlineData("python", typeof(PythonAnalysisExporter))]
    [InlineData("PYTHON", typeof(PythonAnalysisExporter))]
    [InlineData("native", typeof(NativeAnalysisExporter))]
    [InlineData("", typeof(NativeAnalysisExporter))]
    [InlineData(null, typeof(NativeAnalysisExporter))]
    public void The_backend_switch_defaults_to_native_and_keeps_python_selectable(string? value, Type expected)
    {
        var exporter = AnalysisExporters.For(value);

        Assert.IsType(expected, exporter);
    }

    [Fact]
    public void The_native_exporter_builds_the_sample_repo_graph_without_python()
    {
        var engine = new CoreGraphEngine(FixtureRepo("sample_repo"), new NativeAnalysisExporter());

        var ids = AllNodeIds(engine);

        Assert.Contains("billing/service.py::class::BillingService", ids);
        Assert.Contains("component::web/widget.ts", ids);
        Assert.All(ids, id => Assert.False(string.IsNullOrEmpty(engine.SummaryText(id))));
    }

    [Fact]
    public void Reanalyze_picks_up_an_appended_function_and_a_deleted_file()
    {
        var root = Directory.CreateTempSubdirectory("native-reanalyze").FullName;
        File.WriteAllText(Path.Combine(root, "a.py"), "def one():\n    return 1\n");
        File.WriteAllText(Path.Combine(root, "b.py"), "def two():\n    return 2\n");
        var engine = new CoreGraphEngine(root, new NativeAnalysisExporter());

        File.AppendAllText(Path.Combine(root, "a.py"), "\ndef three():\n    return one()\n");
        File.Delete(Path.Combine(root, "b.py"));
        engine.Reanalyze(["a.py", "b.py"]);

        var ids = AllNodeIds(engine);
        Assert.Contains("a.py::function::three", ids);
        Assert.DoesNotContain("b.py::function::two", ids);
        Assert.Contains(engine.GetDependencies("a.py::function::three"), n => n.Id == "a.py::function::one");
    }
}
