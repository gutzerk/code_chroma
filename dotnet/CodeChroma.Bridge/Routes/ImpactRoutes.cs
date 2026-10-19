using System.Text.Json.Nodes;
using CodeChroma.Bridge.Diagrams;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Prs;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>The Impact diagram's change review: what the diff does to each box, where the review is written, and the unified review result.</summary>
public static class ImpactRoutes
{
    /// <summary>The kinds with a unified /review flow (those whose definition carries a review axis).</summary>
    private static readonly HashSet<string> ReviewKinds = ["impact"];

    public static void Map(WebApplication app)
    {
        var parser = DiffRoutes.ParserFor(app);
        app.MapGet("/repos/{repoId}/impact-changes", (string repoId, WorkspaceRegistry registry, PrManager prs) =>
        {
            var ws = registry.Get(repoId);
            ws.Sync();
            return Reply.Json(Review(ws, parser, prs));
        });
        app.MapGet("/repos/{repoId}/impact-changes-path", (string repoId, WorkspaceRegistry registry, PrManager prs) =>
        {
            var ws = registry.Get(repoId);
            return Reply.Json(new JsonObject
            {
                ["repo_root"] = ws.Root,
                ["impact_changes_path"] = ImpactChanges.Path(ws.Root),
                ["fingerprint"] = Review(ws, parser, prs)["fingerprint"]!.DeepClone(),
            });
        });
        app.MapGet("/repos/{repoId}/{kind}/review", (string repoId, string kind, WorkspaceRegistry registry) =>
            ReviewKinds.Contains(kind)
                ? Reply.Json(ImpactChanges.ReviewResult(registry.Get(repoId), parser, kind))
                : Reply.Error(404, $"'{kind}' has no review flow"));
    }

    private static JsonObject Review(Workspace ws, IOldSymbolParser parser, PrManager prs)
    {
        var record = prs.FindById(ws.Id);
        return ImpactChanges.Resolve(ws, parser, DiagramArtifacts.Load(ws, "impact"), ImpactChanges.LoadAuthored(ws), record?.ReviewComments, record?.GeneralComments);
    }
}
