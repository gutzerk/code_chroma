using System.Text.Json.Nodes;
using CodeChroma.Bridge.Diagrams;
using CodeChroma.Bridge.Epics;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;
using CodeChroma.Core.Patterns;

namespace CodeChroma.Bridge.Routes;

/// <summary>GET /repos/{id}/{kind}/context: the unified {coverage, staleness, generation_data} envelope per built-in diagram kind.</summary>
public static class ContextRoutes
{
    /// <summary>Kinds with a context envelope here; sequence is not served by the C# bridge yet.</summary>
    public static readonly IReadOnlyList<string> Kinds = ["c1", "epics", "patterns", "impact"];

    public static void Map(WebApplication app)
    {
        var parser = DiffRoutes.ParserFor(app);
        foreach (var kind in Kinds)
        {
            var k = kind;
            app.MapGet($"/repos/{{repoId}}/{k}/context", (string repoId, string? source, string? feature, WorkspaceRegistry registry) =>
                Reply.Json(Envelope(registry.Get(repoId), k, parser, source ?? "diff", feature)));
        }
    }

    public static JsonObject Envelope(Workspace ws, string kind, IOldSymbolParser parser, string source = "diff", string? feature = null) => new()
    {
        ["coverage"] = null,
        ["staleness"] = kind == "patterns" ? PatternsStaleness(ws) : null,
        ["generation_data"] = kind switch
        {
            "epics" => EpicsAssembler.For(ws.Root).Index(),
            "patterns" => ws.Engine.PatternsContext(),
            "impact" => ImpactContext.Build(ws, parser, source, feature),
            _ => null,
        },
    };

    /// <summary>Live candidates vs what was reviewed, the same signal the resolved patterns diagram carries.</summary>
    private static JsonObject PatternsStaleness(Workspace ws)
    {
        var authored = DiagramArtifacts.Load(ws, "patterns");
        var fingerprint = PatternSerialize.FingerprintFor(ws.Engine.PatternCandidates());
        return DiagramResolver.AttachStaleness(new JsonObject(), fingerprint, Json.Str(authored["fingerprint"]));
    }
}
