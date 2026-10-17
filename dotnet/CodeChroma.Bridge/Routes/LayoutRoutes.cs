using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>The hierarchy view's saved box positions (.codechroma/hierarchy-layout.json); diagram layouts live on canvas.json.</summary>
public static class LayoutRoutes
{
    public static string LayoutPath(Workspace ws, string kind) => Path.Combine(ws.Root, ".codechroma", $"{kind}-layout.json");

    public static void Map(WebApplication app)
    {
        app.MapGet("/repos/{repoId}/hierarchy/layout", (string repoId, WorkspaceRegistry registry) =>
            Reply.Json(Sanitize(JsonFile.Load(LayoutPath(registry.Get(repoId), "hierarchy")))));

        app.MapPost("/repos/{repoId}/hierarchy/layout", async (string repoId, HttpRequest request, WorkspaceRegistry registry) =>
        {
            var layout = Sanitize(await Reply.LenientBody(request));
            JsonFile.Write(LayoutPath(registry.Get(repoId), "hierarchy"), layout);
            return Reply.Json(layout);
        });
    }

    /// <summary>Keeps only box-id to {x, y} entries with finite numeric coordinates.</summary>
    public static JsonObject Sanitize(JsonNode? raw)
    {
        var clean = new JsonObject();
        if (raw is not JsonObject map) return clean;
        foreach (var (id, value) in map)
            if (value is JsonObject point && Number(point["x"]) is { } x && Number(point["y"]) is { } y)
                clean[id] = new JsonObject { ["x"] = x, ["y"] = y };
        return clean;
    }

    private static double? Number(JsonNode? node) =>
        node is JsonValue v && v.GetValueKind() == JsonValueKind.Number && v.GetValue<double>() is var d && double.IsFinite(d) ? d : null;
}
