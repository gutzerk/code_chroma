using System.Text.Json.Nodes;
using CodeChroma.Bridge.Epics;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>GET /repos/{id}/{kind}/context: the unified {coverage, staleness, generation_data} envelope per built-in diagram kind.</summary>
public static class ContextRoutes
{
    /// <summary>Kinds whose generation data needs no engine slice; patterns, impact and sequence are served elsewhere.</summary>
    public static readonly IReadOnlyList<string> Kinds = ["c1", "epics"];

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
        ["staleness"] = null,
        ["generation_data"] = kind == "epics" ? EpicsAssembler.For(ws.Root).Index() : null,
    };
}
