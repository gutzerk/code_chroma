using System.Text.Json.Nodes;
using CodeChroma.Bridge.Diagrams;
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
                : Reply.Json(ResolveCustom(ws, id, library));
        });

        app.MapDelete("/repos/{repoId}/custom/{typeId}", (string repoId, string typeId, WorkspaceRegistry registry) =>
            DiagramLibrary.ValidTypeId(typeId) ? Deleted(registry.Get(repoId), $"custom/{typeId}") : InvalidType(typeId));

        app.MapGet("/repos/{repoId}/custom/{typeId}/context", (string repoId, string typeId, WorkspaceRegistry registry, DiagramLibrary library) =>
        {
            if (!DiagramLibrary.ValidTypeId(typeId)) return InvalidType(typeId);
            if (library.LoadType(typeId) is not { } definition) return Reply.Error(404, $"unknown diagram kind: 'custom/{typeId}'");
            return Reply.Json(CustomContext(registry.Get(repoId), typeId, definition));
        });

        app.MapGet("/repos/{repoId}/feature-plan/{slug}", (string repoId, string slug, WorkspaceRegistry registry) =>
        {
            var wantsPath = slug.EndsWith(PathSuffix, StringComparison.Ordinal);
            var id = wantsPath ? slug[..^PathSuffix.Length] : slug;
            if (!DiagramLibrary.ValidTypeId(id)) return Reply.Error(400, $"invalid feature-plan slug: '{id}'");
            var ws = registry.Get(repoId);
            return wantsPath
                ? PathResponse(ws, $"feature-plan/{id}", "feature_plan_path")
                : Reply.Json(ResolveFeaturePlan(ws, id));
        });

        app.MapDelete("/repos/{repoId}/feature-plan/{slug}", (string repoId, string slug, WorkspaceRegistry registry) =>
            DiagramLibrary.ValidTypeId(slug) ? Deleted(registry.Get(repoId), $"feature-plan/{slug}") : Reply.Error(400, $"invalid feature-plan slug: '{slug}'"));
    }

    /// <summary>A custom type's payload: shared resolve with the type's own style, grouping gate, coverage and staleness.</summary>
    public static JsonObject ResolveCustom(Workspace ws, string typeId, DiagramLibrary library)
    {
        var definition = library.LoadType(typeId)!;
        var data = DiagramArtifacts.Load(ws, $"custom/{typeId}");
        var resolved = DiagramResolver.Resolve(ws.Engine, data, definition["style"]);
        resolved["has_diagram"] = data.Count > 0;
        if (!GroupingEnabled(definition)) resolved["groups"] = new JsonArray();
        DiagramResolver.AttachCoverage(resolved, ws.Engine);
        return DiagramResolver.AttachStaleness(resolved, DiagramArtifacts.DigestFingerprint(ws), Json.Str(data["fingerprint"]));
    }

    public static JsonObject ResolveFeaturePlan(Workspace ws, string slug)
    {
        var data = DiagramArtifacts.Load(ws, $"feature-plan/{slug}");
        var resolved = DiagramResolver.Resolve(ws.Engine, data);
        resolved["has_diagram"] = data.Count > 0;
        return resolved;
    }

    /// <summary>A type's own grouping toggle AND a style that supports groups.</summary>
    public static bool GroupingEnabled(JsonObject definition)
    {
        var style = Json.Str(definition["style"]) is { } id ? DiagramStyles.Catalog(id) : null;
        var wants = definition["grouping"] is JsonObject g && Json.Truthy(g["enabled"]);
        return wants && style?["overrides"] is JsonObject o && Json.Truthy(o["supports_groups"]);
    }

    private static JsonObject CustomContext(Workspace ws, string typeId, JsonObject definition)
    {
        JsonNode? coverage = null;
        if (definition["addons"] is JsonObject addons && Json.Truthy(addons["coverage"]))
        {
            var diagram = DiagramArtifacts.Load(ws, $"custom/{typeId}");
            var report = Coverage.Report(ws.Engine, DiagramResolver.AuthoredPaths(diagram));
            var withFlag = new JsonObject { ["has_diagram"] = diagram.Count > 0 };
            foreach (var (k, v) in report) withFlag[k] = v?.DeepClone();
            coverage = withFlag;
        }
        return new JsonObject { ["coverage"] = coverage, ["staleness"] = null, ["generation_data"] = null };
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
