using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>GET/PATCH /repos/{id}/canvas -- the one document and the one write point (016-single-canvas).</summary>
public static class CanvasRoutes
{
    public static void Map(WebApplication app)
    {
        app.MapGet("/repos/{repoId}/canvas", (string repoId, WorkspaceRegistry registry) =>
        {
            var ws = registry.Get(repoId);
            return Reply.Json(CanvasDoc.Load(ws.CanvasCorePath(), ws.DiagramsRoot()).ToJson());
        });
        app.MapPatch("/repos/{repoId}/canvas", Patch);
    }

    /// <summary>Applies one batch of ops; layout/content only, so a read-only PR checkout can edit it too.</summary>
    private static async Task<IResult> Patch(string repoId, HttpRequest request, WorkspaceRegistry registry)
    {
        JsonNode? body;
        try
        {
            body = await JsonNode.ParseAsync(request.Body);
        }
        catch (JsonException)
        {
            body = null;
        }
        if (body is not JsonObject batch) return Reply.Error(422, new JsonArray(new JsonObject { ["type"] = "dict_type", ["loc"] = new JsonArray("body"), ["msg"] = "Input should be a valid dictionary" }));

        var ws = registry.Get(repoId);
        var ops = Json.Truthy(batch["ops"]) && batch["ops"] is JsonArray array ? array.ToList() : [];
        var layer = batch.ContainsKey("layer") ? Json.Str(batch["layer"]) ?? "default" : "default";
        var explanation = batch.ContainsKey("explanation") ? Json.Str(batch["explanation"]) ?? "" : "";
        lock (CanvasWrite.LockFor(ws.Id))
        {
            var doc = CanvasDoc.Load(ws.CanvasCorePath(), ws.DiagramsRoot());
            var result = ApplyBatch.Apply(doc, ops, layer, explanation, Json.Truthy(batch["confirm_mass_delete"]));
            return Reply.Json(CanvasWrite.Commit(ws, result));
        }
    }
}
