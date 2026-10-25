using System.Text.Json.Nodes;
using CodeChroma.Bridge.Diagrams;
using CodeChroma.Bridge.Engine;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;
using CodeChroma.Core.Patterns;

namespace CodeChroma.Bridge.Tests.Diagrams;

public sealed class DiagramBootstrapTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("cc-boot-").FullName;

    public void Dispose() => Directory.Delete(_root, recursive: true);

    private sealed class StubLlm(string reply) : ILlmCompletion
    {
        public int Calls { get; private set; }

        public Task<string> Complete(string user, string model, int maxTokens, string? system = null)
        {
            Calls++;
            return Task.FromResult(reply);
        }
    }

    private sealed class CandidateEngine(IReadOnlyList<PatternInstance> candidates) : IGraphEngine
    {
        public GraphNode? GetNode(string id) => null;
        public IReadOnlyList<GraphNode> GetChildren(string id) => [];
        public SymbolInfo? GetSymbol(string id) => null;
        public IReadOnlyList<GraphNode> GetDependencies(string id) => [];
        public IReadOnlyList<GraphNode> GetDependents(string id) => [];
        public string? SummaryText(string id) => null;
        public string? FunctionNodeAtLine(string relPath, int line) => null;
        public void Reanalyze(IReadOnlyList<string> changedPaths) { }
        public IReadOnlyList<PatternInstance> PatternCandidates() => candidates;
    }

    private static PatternInstance Candidate() => new(
        "strategy:pay", PatternType.Strategy, "Pay", 0.8,
        [new PatternParticipant("p1", PatternRole.Interface, "Pay", "m.Pay", "n1", "m.py")],
        [new PatternRelation("p1", "p1", PatternRelationKind.Uses)]);

    private Workspace Open(bool readOnly = false, params PatternInstance[] candidates) =>
        new("main", _root, new CandidateEngine(candidates), (_, _) => { }, readOnly);

    private static Func<(ILlmCompletion?, string)> Quick(ILlmCompletion? llm) => () => (llm, "m");

    [Fact]
    public void A_missing_c1_gets_a_draft_system_node()
    {
        var ws = Open();

        new DiagramBootstrap(Quick(null)).IfMissing(ws);

        var c1 = JsonNode.Parse(File.ReadAllText(ws.DiagramPath("c1")))!;
        Assert.True((bool)c1["draft"]!);
        Assert.Equal("system", (string?)c1["nodes"]![0]!["id"]);
    }

    [Fact]
    public void An_existing_c1_is_left_alone()
    {
        var ws = Open();
        JsonFile.Write(ws.DiagramPath("c1"), new JsonObject { ["type"] = "c1" });

        new DiagramBootstrap(Quick(null)).IfMissing(ws);

        Assert.Null(JsonNode.Parse(File.ReadAllText(ws.DiagramPath("c1")))!["draft"]);
    }

    [Fact]
    public void A_read_only_workspace_generates_nothing()
    {
        var llm = new StubLlm("{}");
        var ws = Open(readOnly: true, Candidate());

        new DiagramBootstrap(Quick(llm)).IfMissing(ws);

        Assert.False(File.Exists(ws.DiagramPath("c1")));
        Assert.Equal(0, llm.Calls);
    }

    [Fact]
    public void Offline_never_writes_patterns()
    {
        var ws = Open(candidates: Candidate());

        DiagramBootstrap.Offline.IfMissing(ws);

        Assert.False(File.Exists(ws.DiagramPath("patterns")));
    }

    [Fact]
    public void A_confirming_model_writes_patterns_once()
    {
        var llm = new StubLlm("{\"confirmations\":[{\"id\":\"strategy:pay\",\"confirmed\":true,\"name\":\"Strategy - pay\",\"description\":\"Picks a payment.\"}]}");
        var ws = Open(candidates: Candidate());
        var bootstrap = new DiagramBootstrap(Quick(llm));

        bootstrap.IfMissing(ws);
        bootstrap.IfMissing(ws);

        var patterns = JsonNode.Parse(File.ReadAllText(ws.DiagramPath("patterns")))!;
        Assert.Equal(1, llm.Calls);
        Assert.Equal("Strategy - pay", (string?)patterns["nodes"]![0]!["name"]);
    }

    [Fact]
    public void A_failed_patterns_generation_is_not_retried_by_the_same_bootstrap()
    {
        var llm = new StubLlm("not json");
        var ws = Open(candidates: Candidate());
        var bootstrap = new DiagramBootstrap(Quick(llm));

        bootstrap.IfMissing(ws);
        bootstrap.IfMissing(ws);

        Assert.Equal(1, llm.Calls);
        Assert.False(File.Exists(ws.DiagramPath("patterns")));
    }

    [Fact]
    public void A_borrowed_c1_is_read_from_the_source_root()
    {
        var main = Directory.CreateTempSubdirectory("cc-main-").FullName;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Workspace.DiagramPath(main, "c1"))!);
            File.WriteAllText(Workspace.DiagramPath(main, "c1"), """{"type":"c1","nodes":[{"id":"system","kind":"system","name":"s"}],"relations":[]}""");
            var ws = new Workspace("pr", _root, new CandidateEngine([]), (_, _) => { }, true) { C1SourceRoot = main };

            var loaded = DiagramArtifacts.Load(ws, "c1");

            Assert.Equal("system", (string?)loaded["nodes"]![0]!["id"]);
        }
        finally { Directory.Delete(main, recursive: true); }
    }

    [Fact]
    public void The_digest_serialization_matches_python_json_dumps()
    {
        var digest = JsonNode.Parse("""{"b":[1,"é"],"a":{"files":[]}}""");

        var text = DiagramArtifacts.PythonDumps(digest);

        Assert.Equal("{\"a\": {\"files\": []}, \"b\": [1, \"\\u00e9\"]}", text);
    }
}
