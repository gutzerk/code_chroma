using CodeChroma.Canvas.Hierarchy;
using CodeChroma.Core;

namespace CodeChroma.Canvas.Tests.Hierarchy;

/// <summary>The hierarchy canvas fed by real C# Core graph output (the shared graph_golden sample repo).</summary>
public class CoreHierarchySourceTests
{
    internal static Graph SampleGraph()
    {
        var input = AnalysisInputReader.Load(Path.Combine(AppContext.BaseDirectory, "fixtures", "sample_repo.input.json"));
        var core = new GraphCore();
        core.Analyze(input);
        return core.Snapshot;
    }

    [Fact]
    public void The_root_children_are_the_systems_with_wire_level_names()
    {
        var source = new CoreHierarchySource(SampleGraph());

        var tops = source.Children(HierarchyIds.Root);

        Assert.Equal(new[] { "billing", "shared", "users", "web" }, tops.Select(t => t.Name));
        Assert.All(tops, t => Assert.Equal("system", t.Level));
        Assert.All(tops, t => Assert.True(t.HasChildren));
    }

    [Fact]
    public void Levels_parents_and_summaries_come_through_the_adapter()
    {
        var source = new CoreHierarchySource(SampleGraph());

        var logicBlock = source.Get("logicblock::billing/reporter.go::function::RenderReport::0")!;
        var component = source.Get("component::billing/reporter.go")!;

        Assert.Equal("logic_block", logicBlock.Level);
        Assert.Equal("billing/reporter.go::function::RenderReport", logicBlock.ParentId);
        Assert.Equal("dir::billing", component.ParentId);
        Assert.StartsWith("Component `reporter.go`", component.Description);
        Assert.Null(source.Get("no-such-node"));
    }

    [Fact]
    public void Expanding_a_real_system_lays_out_its_real_children_inside_it()
    {
        var source = new CoreHierarchySource(SampleGraph());
        var expansion = new ExpansionState(source);
        expansion.Expand("dir::billing");

        var scene = HierarchyLayout.Compute(source, expansion);

        var kids = scene.ChildrenOf("dir::billing").Select(k => k.Item.Name).ToList();
        Assert.Contains("reporter.go", kids);
        Assert.Contains("models", kids);
    }

    [Fact]
    public void A_function_s_code_is_sliced_out_of_its_file_by_line_span()
    {
        var graph = SampleGraph();
        var function = graph.Nodes.Values.First(n => n.Name == "create_invoice" && n.Level == HierarchyLevel.Function);
        var symbol = graph.Symbols[function.Id];
        var file = string.Join("\n", Enumerable.Range(1, 30).Select(i => $"line {i}"));
        var source = new CoreCodeSource(graph, path => path == symbol.FilePath ? file : null);

        var snippet = source.Get(function.Id)!;

        Assert.Equal(symbol.StartLine, snippet.StartLine);
        Assert.Equal(symbol.EndLine - symbol.StartLine + 1, snippet.Text.Split('\n').Length);
        Assert.StartsWith($"line {symbol.StartLine}", snippet.Text);
        Assert.Equal("python", snippet.Language);
    }

    [Fact]
    public void A_node_without_readable_source_has_no_snippet()
    {
        var graph = SampleGraph();
        var source = new CoreCodeSource(graph, _ => null);

        Assert.Null(source.Get("component::billing/reporter.go"));
        Assert.Null(source.Get("missing"));
    }
}
