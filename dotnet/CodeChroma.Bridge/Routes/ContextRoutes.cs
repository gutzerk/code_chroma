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
    /// <summary>Kinds with a context envelope here; impact and sequence are not served by the C# bridge yet.</summary>
    public static readonly IReadOnlyList<string> Kinds = ["c1", "epics", "patterns"];

    public static void Map(WebApplication app)
    {
        foreach (var kind in Kinds)
        {
            var k = kind;
            app.MapGet($"/repos/{{repoId}}/{k}/context", (string repoId, WorkspaceRegistry registry) =>
                Reply.Json(Envelope(registry.Get(repoId), k)));
        }
    }

    public static JsonObject Envelope(Workspace ws, string kind) => new()
    {
        ["coverage"] = null,
        ["staleness"] = kind == "patterns" ? PatternsStaleness(ws) : null,
        ["generation_data"] = kind switch
        {
            "epics" => EpicsAssembler.For(ws.Root).Index(),
            "patterns" => ws.Engine.PatternsContext(),
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
