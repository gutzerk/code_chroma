using System.Text.Json.Nodes;
using CodeChroma.Bridge.Context;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>POST /repos/{id}/diagram-context: the gathered architecture context for a diagram type, as text and as a file the agent can read.</summary>
public static class DiagramContextRoutes
{
    public static void Map(WebApplication app)
    {
        app.MapPost("/repos/{repoId}/diagram-context", async (string repoId, HttpRequest http, WorkspaceRegistry registry, DiagramContext context) =>
        {
            var body = await Reply.LenientBody(http);
            if (Json.Str(body["type"]) is not { } type || !DiagramContext.Types.Contains(type)) return Reply.Error(400, "type must be one of: " + string.Join(", ", DiagramContext.Types.Order()));
            var ws = registry.Get(repoId);
            var path = await context.WriteFileAsync(ws, type, Json.Str(body["request"]));
            return Reply.Json(new JsonObject { ["available"] = path is not null, ["path"] = path });
        });
    }
}
