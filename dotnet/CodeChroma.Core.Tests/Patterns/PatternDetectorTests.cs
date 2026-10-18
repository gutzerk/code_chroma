using System.Text.Json.Nodes;
using CodeChroma.Core.Analyzers;
using CodeChroma.Core.Patterns;

namespace CodeChroma.Core.Tests.Patterns;

public class PatternDetectorTests
{
    private static (Graph Graph, Dictionary<string, ClassShape> Shapes) Analyze(string path, string source)
    {
        var symbols = AnalyzerRegistry.WithDefaults().ForFile(path)!.Parse(path, source);
        var shapes = ClassShapeExtractor.Extract(path, source).ToDictionary(p => p.Key, p => p.Value);
        return (new Graph([], symbols), shapes);
    }

    private static List<PatternInstance> Detect(string path, string source)
    {
        var (graph, shapes) = Analyze(path, source);
        return PatternDetector.DetectCandidates(graph, shapes);
    }

    [Fact]
    public void Strategy_PythonAbstractBaseWithTwoImplementationsAndADispatcher()
    {
        const string source = """
            from abc import ABC, abstractmethod

            class Pricer(ABC):
                @abstractmethod
                def price(self, item): ...

            class Flat(Pricer):
                def price(self, item): return 1

            class Tiered(Pricer):
                def price(self, item): return 2

            class Cart:
                def total(self, pricer, item):
                    return pricer.price(item)
            """;

        var strategy = Detect("shop.py", source).Single(i => i.Type == PatternType.Strategy);

        Assert.Equal("strategy::shop.py::class::Pricer", strategy.Id);
        Assert.Equal(0.6, strategy.Confidence);
        Assert.Equal(["Pricer", "Flat", "Tiered", "Cart"], strategy.Participants.Select(p => p.Name));
        Assert.Contains(strategy.Relations, r => r.Kind == PatternRelationKind.Uses && r.FromId.EndsWith("Cart"));
    }

    [Fact]
    public void Singleton_PythonClassAttrCheckedForNoneAndSet()
    {
        const string source = """
            class Config:
                _inst = None

                @classmethod
                def get(cls):
                    if cls._inst is None:
                        cls._inst = Config()
                    return cls._inst
            """;

        var singleton = Detect("cfg.py", source).Single(i => i.Type == PatternType.Singleton);

        Assert.Equal("Singleton — Config", singleton.Name);
        Assert.Equal(0.7, singleton.Confidence);
    }

    [Fact]
    public void Registry_And_Observer_PythonDictWriteAndListAppendIterate()
    {
        const string source = """
            class Hub:
                handlers = {}

                def __init__(self):
                    self.listeners = []

                def register(self, k, v):
                    self.handlers[k] = v

                def subscribe(self, fn):
                    self.listeners.append(fn)

                def emit(self):
                    for fn in self.listeners:
                        fn()
            """;

        var types = Detect("hub.py", source).Select(i => i.Type).ToList();

        Assert.Equal([PatternType.Registry, PatternType.Observer], types);
    }

    [Fact]
    public void Strategy_GoInterfaceMatchedStructurallyByMethodSet()
    {
        const string source = """
            package pay

            type Charger interface {
                Charge(n int)
            }

            type Card struct{}
            func (c *Card) Charge(n int) {}

            type Cash struct{}
            func (c *Cash) Charge(n int) {}
            """;

        var strategy = Detect("pay/pay.go", source).Single(i => i.Type == PatternType.Strategy);

        Assert.Equal(["Charger", "Card", "Cash"], strategy.Participants.Select(p => p.Name));
    }

    [Fact]
    public void Singleton_GoPackageVarGuardedBySyncOnce()
    {
        const string source = """
            package db

            import "sync"

            type Pool struct{}

            var inst *Pool
            var once sync.Once

            func Get() *Pool {
                once.Do(func() { inst = &Pool{} })
                return inst
            }
            """;

        var singleton = Detect("db/db.go", source).Single(i => i.Type == PatternType.Singleton);

        Assert.Equal("Singleton — Pool", singleton.Name);
        Assert.Equal(0.6, singleton.Confidence);
    }

    [Fact]
    public void Repository_GroupsImplementationsUnderTheirInterfaceBase()
    {
        const string source = """
            class UserRepository: ...

            class SqlUserRepository(UserRepository): ...

            class MemUserRepository(UserRepository): ...
            """;

        var repo = Detect("repo.py", source).Single(i => i.Type == PatternType.Repository);

        Assert.Equal("Repository — UserRepository", repo.Name);
        Assert.Equal(3, repo.Participants.Count);
    }
}

public class PatternParityTests
{
    [Fact]
    public void Candidates_And_Fingerprint_MatchThePythonGolden()
    {
        var root = Path.Combine(Fixtures.FixturesDir, "patterns_repo");
        var input = new AnalysisExporter().Full(root);
        var graph = Fixtures.Build(input);
        var shapes = ClassShapeExtractor.ExtractAll(root, input.Files.Select(f => f.Path));
        var expected = JsonNode.Parse(File.ReadAllText(Path.Combine(Fixtures.FixturesDir, "pattern_golden", "patterns_repo.expected.json")))!;

        var candidates = PatternDetector.DetectCandidates(graph, shapes);

        var actual = new JsonArray(candidates.Select(c => (JsonNode)PatternSerialize.SerializeInstance(c)).ToArray());
        Assert.Equal(expected["candidates"]!.ToJsonString(), actual.ToJsonString());
        Assert.Equal(expected["fingerprint"]!.GetValue<string>(), PatternSerialize.FingerprintFor(candidates));
    }
}
