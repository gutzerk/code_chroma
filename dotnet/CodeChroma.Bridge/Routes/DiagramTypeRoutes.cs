using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>The custom diagram-type library plus the per-repo custom and feature-plan artifact paths; resolved payloads are not ported.</summary>
public static class DiagramTypeRoutes
{
    private const string PathSuffix = "-path";

    public static void Map(WebApplication app)
    {
        app.MapGet("/diagram-styles", () => Reply.Json(new JsonObject { ["styles"] = LlmCatalog.Data["diagram_styles"]!.DeepClone() }));
        app.MapGet("/diagram-types", (DiagramLibrary library) => Reply.Json(new JsonObject { ["types"] = library.ListTypes() }));

        app.MapGet("/diagram-types/{typeId}", (string typeId, DiagramLibrary library) =>
        {
            if (!DiagramLibrary.ValidTypeId(typeId)) return InvalidType(typeId);
            return library.LoadType(typeId) is { } definition ? Reply.Json(definition) : Unknown(typeId);
        });

        app.MapPut("/diagram-types/{typeId}", async (string typeId, HttpRequest request, DiagramLibrary library) =>
        {
            if (!DiagramLibrary.ValidTypeId(typeId)) return InvalidType(typeId);
            var body = await Reply.LenientBody(request);
            body["id"] = typeId;
            try
            {
                return Reply.Json(library.Save(body));
            }
            catch (ArgumentException error)
            {
                return Reply.Error(400, error.Message);
            }
        });

        app.MapDelete("/diagram-types/{typeId}", (string typeId, DiagramLibrary library) =>
        {
            if (!DiagramLibrary.ValidTypeId(typeId)) return InvalidType(typeId);
            return library.DeleteType(typeId) ? Reply.Json(new JsonObject { ["deleted"] = typeId }) : Unknown(typeId);
        });

        app.MapGet("/repos/{repoId}/custom/{typeId}", (string repoId, string typeId, WorkspaceRegistry registry, DiagramLibrary library) =>
        {
            var wantsPath = typeId.EndsWith(PathSuffix, StringComparison.Ordinal);
            var id = wantsPath ? typeId[..^PathSuffix.Length] : typeId;
            if (!DiagramLibrary.ValidTypeId(id)) return InvalidType(id);
            if (library.LoadType(id) is null) return Reply.Error(404, $"unknown diagram kind: 'custom/{id}'");
            var ws = registry.Get(repoId);
            return wantsPath
                ? PathResponse(ws, $"custom/{id}", "custom_path")
                : Reply.Json(DiagramRoutes.LoadArtifact(ws, $"custom/{id}") ?? new JsonObject());
        });

        app.MapDelete("/repos/{repoId}/custom/{typeId}", (string repoId, string typeId, WorkspaceRegistry registry) =>
            DiagramLibrary.ValidTypeId(typeId) ? Deleted(registry.Get(repoId), $"custom/{typeId}") : InvalidType(typeId));

        app.MapGet("/repos/{repoId}/feature-plan/{slug}", (string repoId, string slug, WorkspaceRegistry registry) =>
        {
            var wantsPath = slug.EndsWith(PathSuffix, StringComparison.Ordinal);
            var id = wantsPath ? slug[..^PathSuffix.Length] : slug;
            if (!DiagramLibrary.ValidTypeId(id)) return Reply.Error(400, $"invalid feature-plan slug: '{id}'");
            var ws = registry.Get(repoId);
            return wantsPath
                ? PathResponse(ws, $"feature-plan/{id}", "feature_plan_path")
                : Reply.Json(DiagramRoutes.LoadArtifact(ws, $"feature-plan/{id}") ?? new JsonObject());
        });

        app.MapDelete("/repos/{repoId}/feature-plan/{slug}", (string repoId, string slug, WorkspaceRegistry registry) =>
            DiagramLibrary.ValidTypeId(slug) ? Deleted(registry.Get(repoId), $"feature-plan/{slug}") : Reply.Error(400, $"invalid feature-plan slug: '{slug}'"));
    }

    private static IResult InvalidType(string typeId) => Reply.Error(400, $"invalid diagram type id: '{typeId}'");

    private static IResult Unknown(string typeId) => Reply.Error(404, $"unknown diagram type: '{typeId}'");

    private static IResult PathResponse(Workspace ws, string kind, string key) =>
        Reply.Json(new JsonObject { ["repo_root"] = ws.Root, [key] = ws.DiagramPath(kind) });

    private static IResult Deleted(Workspace ws, string kind)
    {
        var path = ws.DiagramPath(kind);
        var existed = File.Exists(path);
        if (existed) File.Delete(path);
        return Reply.Json(new JsonObject { ["deleted"] = existed });
    }
}
