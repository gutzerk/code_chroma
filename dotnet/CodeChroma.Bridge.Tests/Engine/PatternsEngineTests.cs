using System.Text.Json.Nodes;
using CodeChroma.Bridge.Diagrams;
using CodeChroma.Bridge.Engine;
using Xunit;

namespace CodeChroma.Bridge.Tests.Engine;

/// <summary>Design-pattern candidates, the resolved patterns diagram and the skill's context payload, over the real native engine.</summary>
public class PatternsEngineTests
{
    private static IGraphEngine EngineFor(string name)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !Directory.Exists(Path.Combine(dir.FullName, "tests", "fixtures", name))) dir = dir.Parent;
        return new CoreEngineFactory(new NativeAnalysisExporter()).Create(Path.Combine(dir!.FullName, "tests", "fixtures", name));
    }

    [Fact]
    public void Resolve_WithNoAuthoredFile_SurfacesTheCandidateLayerButIsNotADiagram()
    {
        var engine = EngineFor("patterns_repo");

        var resolved = PatternsResolver.Resolve(engine, new JsonObject());

        Assert.False(resolved["has_diagram"]!.GetValue<bool>());
        Assert.False(resolved["stale"]!.GetValue<bool>());
        Assert.Equal(engine.PatternCandidates().Count, resolved["nodes"]!.AsArray().Count(n => n!["kind"]?.GetValue<string>() == "pattern-instance"));
    }

    [Fact]
    public void Resolve_OverlaysTheConfirmedFlagAndMarksAChangedCandidateSetStale()
    {
        var engine = EngineFor("patterns_repo");
        var singleton = engine.PatternCandidates().First(c => c.Id.StartsWith("singleton::py/"));
        var authored = new JsonObject
        {
            ["fingerprint"] = "0000",
            ["nodes"] = new JsonArray(new JsonObject
            {
                ["id"] = singleton.Id, ["kind"] = "pattern-instance", ["name"] = "Config singleton",
                ["meta"] = new JsonObject { ["confirmed"] = true },
            }),
        };

        var resolved = PatternsResolver.Resolve(engine, authored);

        var node = resolved["nodes"]!.AsArray().Single(n => n!["id"]!.GetValue<string>() == singleton.Id)!;
        Assert.Equal("Config singleton", node["name"]!.GetValue<string>());
        Assert.True(node["meta"]!["confirmed"]!.GetValue<bool>());
        Assert.True(resolved["stale"]!.GetValue<bool>());
    }

    [Fact]
    public void Resolve_DropsARejectedInstanceTogetherWithItsParticipants()
    {
        var engine = EngineFor("patterns_repo");
        var strategy = engine.PatternCandidates().First(c => c.Id.StartsWith("strategy::py/"));
        var authored = new JsonObject
        {
            ["nodes"] = new JsonArray(new JsonObject
            {
                ["id"] = strategy.Id, ["kind"] = "pattern-instance", ["meta"] = new JsonObject { ["confirmed"] = false },
            }),
        };

        var resolved = PatternsResolver.Resolve(engine, authored);

        var ids = resolved["nodes"]!.AsArray().Select(n => n!["id"]!.GetValue<string>()).ToList();
        Assert.DoesNotContain(strategy.Id, ids);
        Assert.DoesNotContain(strategy.Participants[1].Id, ids);
    }

    [Fact]
    public void PatternsContext_ListsEveryClassShapeAndTheSeedCandidates()
    {
        var engine = EngineFor("patterns_repo");

        var context = engine.PatternsContext()!;

        var pricer = context["classes"]!.AsArray().Single(c => c!["name"]!.GetValue<string>() == "Pricer")!;
        Assert.True(pricer["is_abstract"]!.GetValue<bool>());
        Assert.Equal(engine.PatternCandidates().Count, context["heuristic_candidates"]!.AsArray().Count);
    }
}
