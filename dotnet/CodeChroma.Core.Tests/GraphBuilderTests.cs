namespace CodeChroma.Core.Tests;

public sealed record DocOnlyCase(string Name, string[] Parsed, string[] Unparsed, (string Dir, bool DocOnly)[] Expect)
{
    public override string ToString() => Name;
}

public class GraphBuilderTests
{
    public static TheoryData<DocOnlyCase> DocOnlyCases() => new()
    {
        new("only a doc file", [], ["docs/README.md"], [("docs", true)]),
        new("doc plus parsed code", ["pkg/mod.py"], ["pkg/README.md"], [("pkg", false)]),
        new("only an unparsed code file", [], ["pkg/broken.py"], [("pkg", false)]),
        new("doc-only subfolder under a mixed parent", ["pkg/mod.py"], ["pkg/docs/README.md", "pkg/docs/guide.rst"],
            [("pkg/docs", true), ("pkg", false)]),
        new("doc-only propagates two levels up", [], ["pkg/docs/guides/one.txt", "pkg/docs/guides/two.txt"],
            [("pkg/docs/guides", true), ("pkg/docs", true), ("pkg", true)]),
    };

    [Theory, MemberData(nameof(DocOnlyCases))]
    public void DocOnly_IsSetOnFoldersWhoseWholeSubtreeIsDocsAndNeverOnFiles(DocOnlyCase c)
    {
        var files = c.Parsed.Select(p => Sym.Parsed(p)).Concat(c.Unparsed.Select(p => new FileSymbols(p, null))).ToList();

        var nodes = GraphBuilder.Build(files).Nodes;

        foreach (var (dir, expected) in c.Expect)
            Assert.Equal(expected, nodes.Single(n => n.SourcePath == dir).DocOnly);
        Assert.All(nodes.Where(n => n.Level == HierarchyLevel.Component), n => Assert.False(n.DocOnly));
    }

    public static TheoryData<string, string> LogicBlockCases() => new()
    {
        { "", "Body@a.py:3-9" },
        { "expr:4-5,expr:6-6", "Step 1@a.py:4-6" },
        { "expr:4-4,if_statement:5-7,expr:8-8,for_statement:9-9", "Step 1@a.py:4-4|Conditional Branch@a.py:5-7|Step 2@a.py:8-8|Loop@a.py:9-9" },
        { "if_statement:4-4,while_statement:5-5", "Conditional Branch@a.py:4-4|Loop@a.py:5-5" },
        { "for_in_statement:4-4,do_statement:5-5", "Loop@a.py:4-4|Loop@a.py:5-5" },
        { "try_statement:4-4,with_statement:5-5,switch_statement:6-6", "Error Handling@a.py:4-4|Context Block@a.py:5-5|Conditional Branch@a.py:6-6" },
    };

    [Theory, MemberData(nameof(LogicBlockCases))]
    public void Function_IsSplitIntoLogicBlocksAtControlFlowBoundaries(string statements, string expected)
    {
        var body = statements == ""
            ? []
            : statements.Split(',').Select(s =>
            {
                var (type, span) = (s.Split(':')[0], s.Split(':')[1].Split('-'));
                return new BodyStatement(type, int.Parse(span[0]), int.Parse(span[1]));
            }).ToArray();
        var module = Sym.Module("a.py");
        var file = new FileSymbols("a.py", [module, Sym.Func("a.py", "run", module.Id, 3, 9, body: body)]);

        var nodes = GraphBuilder.Build([file]).Nodes;

        var blocks = nodes.Where(n => n.Level == HierarchyLevel.LogicBlock).Select(n => $"{n.Name}@{n.SourcePath}");
        Assert.Equal(expected, string.Join("|", blocks));
        var code = nodes.Where(n => n.Level == HierarchyLevel.Code).ToList();
        Assert.All(code, c => Assert.Equal($"code::{c.ParentIds.Single()}", c.Id));
        Assert.Equal(blocks.Count(), code.Count);
    }

    [Fact]
    public void Classes_BecomeServicesAndBareFunctionsShareOneModuleFunctionsService()
    {
        var module = Sym.Module("a.py");
        var cls = Sym.Class("a.py", "Box", module.Id);
        var method = Sym.Func("a.py", "Box.open", cls.Id);
        var bare = Sym.Func("a.py", "helper", module.Id);

        var nodes = GraphBuilder.Build([new FileSymbols("a.py", [module, cls, method, bare])]).Nodes.ToDictionary(n => n.Id);

        Assert.Equal(["component::a.py"], nodes[cls.Id].ParentIds);
        Assert.Equal([cls.Id], nodes[method.Id].ParentIds);
        Assert.Equal("Module Functions", nodes["service::a.py::functions"].Name);
        Assert.Equal(["service::a.py::functions"], nodes[bare.Id].ParentIds);
    }

    [Fact]
    public void UnparsedFile_GetsAChildlessComponentUnderItsDirectory()
    {
        var nodes = GraphBuilder.Build([new FileSymbols("pkg/blob.bin", null)]).Nodes.ToDictionary(n => n.Id);

        Assert.Equal(["dir::pkg"], nodes["component::pkg/blob.bin"].ParentIds);
        Assert.DoesNotContain(nodes.Values, n => n.ParentIds.Contains("component::pkg/blob.bin"));
    }

    public static TheoryData<string, HierarchyLevel, string, string> DirectoryMirrorCases() => new()
    {
        { "component::shared/text_utils.py", HierarchyLevel.Component, "text_utils.py", "dir::shared" },
        { "component::billing/models/invoice.py", HierarchyLevel.Component, "invoice.py", "dir::billing/models" },
        { "dir::billing/models", HierarchyLevel.Pillar, "models", "dir::billing" },
        { "dir::billing", HierarchyLevel.System, "billing", "" },
    };

    [Theory, MemberData(nameof(DirectoryMirrorCases))]
    public void Hierarchy_MirrorsTheDirectoryTreeAndAFileHasOnlyItsOwnDirectoryAsParent(
        string id, HierarchyLevel level, string name, string parent)
    {
        var graph = Fixtures.GraphOf("sample_repo");

        var node = graph.Nodes[id];

        Assert.Equal((level, name), (node.Level, node.Name));
        string[] expectedParents = parent == "" ? [] : [parent];
        Assert.Equal(expectedParents, node.ParentIds);
        if (parent != "") Assert.Contains(node, graph.ChildrenOf(parent));
    }

    [Fact]
    public void Hierarchy_HasAllSevenLevelsAndSeveralSystemsInAMonorepo()
    {
        var graph = Fixtures.GraphOf("sample_repo");

        var roots = graph.ChildrenOf(Graph.RootSentinel);

        Assert.All(roots, r => Assert.Equal(HierarchyLevel.System, r.Level));
        Assert.True(roots.Count >= 2);
        Assert.Equal(Enum.GetValues<HierarchyLevel>().ToHashSet(), graph.NodeList.Select(n => n.Level).ToHashSet());
    }

    [Fact]
    public void Hierarchy_EveryFunctionHasLogicBlocksAndEveryChildLinkIsSymmetric()
    {
        var graph = Fixtures.GraphOf("sample_repo");

        var functions = graph.NodeList.Where(n => n.Level == HierarchyLevel.Function).ToList();

        Assert.NotEmpty(functions);
        Assert.All(functions, f =>
        {
            var blocks = graph.ChildrenOf(f.Id);
            Assert.NotEmpty(blocks);
            Assert.All(blocks, b => Assert.Equal(HierarchyLevel.LogicBlock, b.Level));
        });
        Assert.All(graph.NodeList.Where(n => n.Level != HierarchyLevel.System), n =>
            Assert.All(n.ParentIds, p => Assert.Contains(n, graph.ChildrenOf(p))));
    }

    public static TheoryData<string, string> ResolvedEdgeCases() => new()
    {
        { "src/pkg/service.py::function::Factory.make", "src/pkg/models.py::function::build" },
        { "src/pkg/service.py::function::Factory._local_helper", "" },
        { "goservice/handler.go::function::Greet", "goutil/helper.go::function::Helper" },
        { "web/index.ts::function::greet", "web/utils.ts::function::helper" },
    };

    [Theory, MemberData(nameof(ResolvedEdgeCases))]
    public void CrossFileCalls_ResolveThroughTheAnalyzersImportAnswersNeverBySelfCalls(string nodeId, string expected)
    {
        var graph = Fixtures.GraphOf("c0_import_resolution");

        var node = graph.Nodes[nodeId];

        string[] expectedDeps = expected == "" ? [] : [expected];
        Assert.Equal(expectedDeps, node.DependsOnIds);
    }

    [Fact]
    public void CallsToAnImportWithNoResolverAnswer_ProduceNoEdge()
    {
        var module = Sym.Module("a.py", new Dictionary<string, string> { ["helper"] = "other.mod" });
        var caller = Sym.Func("a.py", "run", module.Id, references: ["helper"]);
        var other = Sym.Module("other/mod.py");
        var target = Sym.Func("other/mod.py", "helper", other.Id);

        var nodes = GraphBuilder.Build([new("a.py", [module, caller]), new("other/mod.py", [other, target])]).Nodes;

        Assert.Empty(nodes.Single(n => n.Id == caller.Id).DependsOnIds);
    }

    [Fact]
    public void SymbolOrigin_IsFileColonLineOrNullWithoutASymbol()
    {
        var symbol = Sym.Module("a.py") with { StartLine = 7 };

        Assert.Equal("a.py:7", GraphBuilder.SymbolOrigin(symbol));
        Assert.Null(GraphBuilder.SymbolOrigin(null));
    }
}
