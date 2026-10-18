using System.Text.Json.Nodes;

namespace CodeChroma.Core.Tests;

public class GraphCoreTests
{
    private sealed class ThrowingSink : IGraphSink
    {
        public void OnGraph(Graph graph) => throw new InvalidOperationException("digest boom");
    }

    private sealed class RecordingSink : IGraphSink
    {
        public List<Graph> Seen { get; } = [];
        public void OnGraph(Graph graph) => Seen.Add(graph);
    }

    private static AnalysisDelta DeltaFrom(JsonNode scenario, params string[] changedPaths)
    {
        var after = AnalysisInputReader.Parse(scenario["after"]!.ToJsonString());
        var changed = after.Files.Where(f => changedPaths.Contains(f.Path)).ToList();
        var removed = changedPaths.Where(p => after.Files.All(f => f.Path != p)).ToList();
        return new AnalysisDelta(changed, removed, after.ImportResolutions);
    }

    private static GraphCore Analyzed(JsonNode scenario, IGraphSink? sink = null)
    {
        var core = new GraphCore(sink);
        core.Analyze(AnalysisInputReader.Parse(scenario["before"]!.ToJsonString()));
        return core;
    }

    [Fact]
    public void ReadAccessors_AreSafeBeforeAnyAnalysis()
    {
        IGraphCore core = new GraphCore();

        Assert.Null(core.GetNode("missing"));
        Assert.Empty(core.GetChildren(Graph.RootSentinel));
        Assert.Empty(core.GetDependencies("missing"));
        Assert.Empty(core.GetDependents("missing"));
    }

    [Fact]
    public void Reanalyze_RequiresAPriorAnalyze()
    {
        IGraphCore core = new GraphCore();

        Assert.Throws<InvalidOperationException>(() => core.Reanalyze(new AnalysisDelta([], [])));
    }

    [Fact]
    public void Analyze_Succeeds_AndExposesTheGraphThroughTheAccessors()
    {
        IGraphCore core = new GraphCore();

        var result = core.Analyze(Fixtures.Input("sample_repo"));

        Assert.Equal("succeeded", result.Status);
        Assert.Equal("dir::shared", core.GetNode("component::shared/text_utils.py")!.ParentIds.Single());
        Assert.Contains(core.GetChildren("dir::shared"), c => c.Id == "component::shared/text_utils.py");
    }

    [Fact]
    public void Dependencies_AndDependents_AreInverseViewsOfTheSameEdges()
    {
        IGraphCore core = new GraphCore();
        core.Analyze(Fixtures.Input("c0_import_resolution"));

        var callees = core.GetDependencies("goservice/handler.go::function::Greet");
        var callers = core.GetDependents("goutil/helper.go::function::Helper");

        Assert.Equal(["goutil/helper.go::function::Helper"], callees.Select(n => n.Id));
        Assert.Contains("goservice/handler.go::function::Greet", callers.Select(n => n.Id));
    }

    [Fact]
    public void Reanalyze_AfterAnAppendedMethod_OnlyAddsNodesFromThatFile()
    {
        var scenario = Fixtures.Scenario("append_method");
        var core = Analyzed(scenario);

        var result = core.Reanalyze(DeltaFrom(scenario, "billing/service.py"));

        Assert.Equal("succeeded", result.Status);
        Assert.Empty(result.Diff.RemovedNodeIds);
        Assert.Empty(result.Diff.ReparentedNodeIds);
        Assert.NotEmpty(result.Diff.AddedNodeIds);
        Assert.All(result.Diff.AddedNodeIds, id => Assert.Contains("billing/service.py", id));
        Assert.NotNull(core.GetNode("billing/service.py::function::BillingService.cancel_invoice"));
    }

    [Fact]
    public void Reanalyze_KeepsUnrelatedNodesAndTheirParentsStable()
    {
        var scenario = Fixtures.Scenario("append_method");
        var core = Analyzed(scenario);
        var before = core.GetNode("component::shared/text_utils.py")!;

        core.Reanalyze(DeltaFrom(scenario, "billing/service.py"));

        Assert.Equal(before.ParentIds, core.GetNode("component::shared/text_utils.py")!.ParentIds);
    }

    [Fact]
    public void Reanalyze_RemovesTheNodesOfADeletedFile()
    {
        var scenario = Fixtures.Scenario("delete_file");
        var core = Analyzed(scenario);

        var result = core.Reanalyze(DeltaFrom(scenario, "web/widget.ts"));

        Assert.Contains("component::web/widget.ts", result.Diff.RemovedNodeIds);
        Assert.Null(core.GetNode("component::web/widget.ts"));
    }

    [Fact]
    public void ASinkFailure_NeverFailsTheAnalysisRun()
    {
        var core = new GraphCore(new ThrowingSink());

        var result = core.Analyze(Fixtures.Input("sample_repo"));

        Assert.Equal("succeeded", result.Status);
    }

    [Fact]
    public void TheSink_SeesTheGraphAfterEveryAnalyzeAndReanalyze()
    {
        var scenario = Fixtures.Scenario("append_method");
        var sink = new RecordingSink();
        var core = Analyzed(scenario, sink);

        core.Reanalyze(DeltaFrom(scenario, "billing/service.py"));

        Assert.Equal(2, sink.Seen.Count);
        Assert.Contains("billing/service.py::function::BillingService.cancel_invoice", sink.Seen[1].Nodes.Keys);
    }

    [Fact]
    public void AnEmptyRepository_YieldsOneSystemPlaceholderNode()
    {
        var core = new GraphCore();

        core.Analyze(new AnalysisInput { SchemaVersion = 1 });

        Assert.Equal(["system::__empty__"], core.Snapshot.NodeList.Select(n => n.Id));
    }

    private const string NL = "\n";

    [Fact]
    public void Reanalyze_WithLiveResolver_AddsEdgeWhenImportTargetIsCreatedLater()
    {
        var root = Directory.CreateTempSubdirectory("cc-reresolve").FullName;
        try
        {
            File.WriteAllText(Path.Combine(root, "a.py"), "import b" + NL + NL + "def run():" + NL + "    return b.go()" + NL);
            var exporter = new Analyzers.AnalysisExporter();
            var core = new GraphCore(liveResolver: new Analyzers.LiveImportResolver(exporter.Registry, root));
            core.Analyze(exporter.Full(root));
            Assert.Empty(core.GetDependencies("a.py::function::run"));
            File.WriteAllText(Path.Combine(root, "b.py"), "def go():" + NL + "    return 1" + NL);

            core.Reanalyze(exporter.Delta(root, ["b.py"]));

            Assert.Contains(core.GetDependencies("a.py::function::run"), n => n.Id == "b.py::function::go");
        }
        finally
        {
            Directory.Delete(root, true);
        }
    }
}
