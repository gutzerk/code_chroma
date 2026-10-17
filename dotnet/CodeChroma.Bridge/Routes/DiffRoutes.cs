using System.Text.Json.Nodes;
using CodeChroma.Bridge.Engine;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>The Diff toggle's two layers: per-function diffs, change cards, and committing one node.</summary>
public static class DiffRoutes
{
    public static void Map(WebApplication app)
    {
        var parser = app.Services.GetService<IOldSymbolParser>() ?? new ExporterSymbolParser(app.Services.GetRequiredService<IAnalysisExporter>());
        app.MapGet("/repos/{repoId}/diff", (string repoId, WorkspaceRegistry registry) =>
        {
            var ws = registry.Get(repoId);
            ws.Sync();
            var entries = FunctionDiffs.Compute(ws.Engine, ws.Root, parser, ws.DiffBase());
            return Reply.Json(new JsonArray(entries.Cast<JsonNode?>().ToArray()));
        });
        app.MapGet("/repos/{repoId}/change-cards", (string repoId, WorkspaceRegistry registry) =>
        {
            var ws = registry.Get(repoId);
            ws.Sync();
            return Reply.Json(ChangeCards.Build(ws.Engine, ws.Root, parser, ws.DiffBase()));
        });
        // The node id contains slashes, so it is peeled off the catch-all's "/accept" tail.
        app.MapPost("/repos/{repoId}/diff/{**rest}", (string repoId, string rest, WorkspaceRegistry registry) => Accept(registry.Get(repoId), rest, parser));
    }

    private static IResult Accept(Workspace ws, string rest, IOldSymbolParser parser)
    {
        if (!rest.EndsWith("/accept", StringComparison.Ordinal)) return Reply.Error(404, "Not Found");
        if (ws.ReadOnly) return Reply.Error(409, "a pull-request workspace is read-only");
        var nodeId = rest[..^"/accept".Length].Replace("%2F", "/", StringComparison.OrdinalIgnoreCase);
        ws.Sync();
        try
        {
            var result = GitAccept.Accept(ws.Engine, ws.Root, parser, nodeId);
            var changed = ws.Sync();
            var paths = changed is { Count: > 0 } ? changed : [result.FilePath];
            ws.Emit(new JsonObject { ["type"] = "changed", ["paths"] = new JsonArray(paths.Select(p => (JsonNode?)JsonValue.Create(p)).ToArray()) });
            return Reply.Json(new JsonObject { ["status"] = "committed", ["file_path"] = result.FilePath, ["commit_sha"] = result.CommitSha });
        }
        catch (DiffNotFoundException error)
        {
            return Reply.Error(404, error.Message);
        }
        catch (GitConflictException error)
        {
            return Reply.Error(409, error.Message);
        }
        catch (GitCommandException error)
        {
            return Reply.Error(500, error.Message);
        }
    }
}
