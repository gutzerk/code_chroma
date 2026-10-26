using System.Text.Json.Nodes;
using CodeChroma.Bridge.Diagrams;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Prs;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>The Impact diagram's change review: what the diff does to each box, where the review is written, and the unified review result.</summary>
public static class ImpactRoutes
{
    /// <summary>Each kind whose definition carries a review axis, mapped to its review.agent_factory name (Python registry.py).</summary>
    private static readonly IReadOnlyDictionary<string, string> ReviewKinds = new Dictionary<string, string> { ["impact"] = "impact-changes" };

    /// <summary>Resolvers keyed by agent_factory name, like Python's _REVIEW_RESOLVERS, so a second axis joins by adding an entry.</summary>
    private static readonly IReadOnlyDictionary<string, Func<Workspace, IOldSymbolParser, string, JsonObject>> ReviewResolvers =
        new Dictionary<string, Func<Workspace, IOldSymbolParser, string, JsonObject>> { ["impact-changes"] = ImpactChanges.ReviewResult };

    /// <summary>The unified ReviewResult for a kind with a review flow; null for one without.</summary>
    private static JsonObject? ResolveReview(Workspace ws, IOldSymbolParser parser, string kind) =>
        ReviewKinds.TryGetValue(kind, out var factory) && ReviewResolvers.TryGetValue(factory, out var resolver) ? resolver(ws, parser, kind) : null;

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
            ResolveReview(registry.Get(repoId), parser, kind) is { } result
                ? Reply.Json(result)
                : Reply.Error(404, $"'{kind}' has no review flow"));
    }

    private static JsonObject Review(Workspace ws, IOldSymbolParser parser, PrManager prs)
    {
        var record = prs.FindById(ws.Id);
        return ImpactChanges.Resolve(ws, parser, DiagramArtifacts.Load(ws, "impact"), ImpactChanges.LoadAuthored(ws), record?.ReviewComments, record?.GeneralComments);
    }
}
