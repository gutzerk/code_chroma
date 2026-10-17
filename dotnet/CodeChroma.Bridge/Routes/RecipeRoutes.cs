using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>Looks up a diagram kind's resolved payload (the same shape `GET /repos/{id}/{kind}` returns).</summary>
public interface IDiagramResolver
{
    /// <summary>The resolved payload for `kind`, or null when no such diagram kind exists.</summary>
    JsonObject? Resolve(Workspace ws, string kind);
}

/// <summary>The stored artifact as the payload; stands in until the kind-specific resolvers are ported.</summary>
public sealed partial class RawDiagramResolver : IDiagramResolver
{
    private static readonly string[] SynthesizedPrefixes = ["custom/", "feature-plan/", "epics/"];

    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9._-]*$")]
    private static partial Regex SafeId();

    public JsonObject? Resolve(Workspace ws, string kind)
    {
        var known = Workspace.DiagramKinds.Contains(kind)
            || SynthesizedPrefixes.Any(prefix => kind.StartsWith(prefix, StringComparison.Ordinal) && SafeId().IsMatch(kind[prefix.Length..]));
        return known ? DiagramRoutes.LoadArtifact(ws, kind) as JsonObject ?? new JsonObject() : null;
    }
}

/// <summary>POST /repos/{id}/recipes/{recipe}/run -- re-projects an already-resolved diagram onto the canvas document.</summary>
public static class RecipeRoutes
{
    public static void Map(WebApplication app)
    {
        var resolver = app.Services.GetService<IDiagramResolver>() ?? new RawDiagramResolver();
        // The recipe name may contain slashes (custom/&lt;id&gt;), so it is peeled off the catch-all's "/run" tail.
        app.MapPost("/repos/{repoId}/recipes/{**rest}", (string repoId, string rest, WorkspaceRegistry registry) => Run(registry.Get(repoId), rest, resolver));
    }

    private static IResult Run(Workspace ws, string rest, IDiagramResolver resolver)
    {
        if (!rest.EndsWith("/run", StringComparison.Ordinal)) return Reply.Error(404, "Not Found");
        var name = rest[..^"/run".Length];
        var recipe = Recipes.RecipeFor(name);
        if (recipe is null) return Reply.Error(404, $"unknown recipe: '{name}'");
        var resolved = resolver.Resolve(ws, name);
        if (resolved is null) return Reply.Error(404, $"unknown diagram kind: '{name}'");

        JsonObject response;
        IReadOnlyList<JsonObject> dropped;
        lock (CanvasWrite.LockFor(ws.Id))
        {
            var doc = CanvasDoc.Load(ws.CanvasCorePath(), ws.DiagramsRoot());
            List<JsonNode?> ops;
            (ops, dropped) = Recipes.RunWithDrops(doc, recipe, resolved);
            // The reconcile only ever deletes this recipe's own AI-owned layer, so replacing many stale boxes on
            // a refresh is deliberate, not a mass delete to gate (same reasoning as removeLayerAndRefresh).
            var result = ApplyBatch.ApplyChunked(doc, ops, layer: name, explanation: $"{name} recipe run", confirmMassDelete: true);
            response = CanvasWrite.Commit(ws, result);
        }
        // Soft on purpose: this never joins `errors`, which would flip `ok` and block the render.
        if (response["ok"]?.GetValue<bool>() == true)
            response["diagnostics"] = DroppedLog.Merge(resolved["diagnostics"], DroppedLog.BuildPayload(dropped));
        return Reply.Json(response);
    }
}
