using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Wiki;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>The plain docstring wiki as a context source: GET /repos/{id}/wiki-context.</summary>
public static class WikiRoutes
{
    public static void Map(WebApplication app) =>
        app.MapGet("/repos/{repoId}/wiki-context", (string repoId, string? paths, WorkspaceRegistry registry) =>
        {
            var ws = registry.WikiOwner(registry.Get(repoId));
            var requested = (paths ?? "").Split(',').Where(p => p.Length > 0).ToList();
            try
            {
                return Reply.Json(WikiContext.ForWorkspace(ws, requested).ToJson());
            }
            catch (Exception error) when (error is IOException or InvalidOperationException or UnauthorizedAccessException)
            {
                return Reply.Error(500, $"wiki sync failed: {error.Message}");
            }
        });
}
