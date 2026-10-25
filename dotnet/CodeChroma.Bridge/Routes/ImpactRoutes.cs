using System.Text.Json.Nodes;
using CodeChroma.Bridge.Diagrams;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Prs;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>The Impact diagram's change review: what the diff does to each box, where the review is written, and the unified review result.</summary>
public static class ImpactRoutes
{
    /// <summary>Kind to review agent factory: the kinds whose definition carries a review axis.</summary>
    private static readonly Dictionary<string, string> ReviewAgentFactories = new() { ["impact"] = "impact-changes" };

    /// <summary>Review agent factory to the resolver of its unified ReviewResult; a factory with no resolver has no flow yet.</summary>
    private static readonly Dictionary<string, Func<Workspace, IOldSymbolParser, string, JsonObject>> ReviewResolvers = new()
    {
        ["impact-changes"] = ImpactChanges.ReviewResult,
    };

    /// <summary>The unified review result for a kind with a review axis, or null for one without.</summary>
    public static JsonObject? ReviewFor(Workspace ws, IOldSymbolParser parser, string kind) =>
        ReviewAgentFactories.TryGetValue(kind, out var factory) && ReviewResolvers.TryGetValue(factory, out var resolve)
            ? resolve(ws, parser, kind)
            : null;

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
            ReviewFor(registry.Get(repoId), parser, kind) is { } result
                ? Reply.Json(result)
                : Reply.Error(404, $"'{kind}' has no review flow"));
    }

    private static JsonObject Review(Workspace ws, IOldSymbolParser parser, PrManager prs)
    {
        var record = prs.FindById(ws.Id);
        return ImpactChanges.Resolve(ws, parser, DiagramArtifacts.Load(ws, "impact"), ImpactChanges.LoadAuthored(ws), record?.ReviewComments, record?.GeneralComments);
    }
}
