using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Live;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>Branch workspaces: reopen the project on another (or a new) branch in its own worktree.</summary>
public static class BranchRoutes
{
    public static void Map(WebApplication app, string repoRoot)
    {
        app.MapGet("/branches", (BranchManager branches) =>
            Reply.Json(new JsonObject { ["branches"] = new JsonArray(branches.List().Select(r => (JsonNode?)r.ToPayload()).ToArray()) }));

        app.MapGet("/branches/choices", (BranchManager branches) =>
        {
            var holders = branches.Holders();
            return Reply.Json(new JsonObject
            {
                ["current"] = BranchManager.CurrentBranch(repoRoot),
                ["branches"] = new JsonArray(BranchManager.ListBranches(repoRoot).Select(name => (JsonNode?)new JsonObject
                {
                    ["name"] = name,
                    ["open"] = holders.ContainsKey(name),
                    ["workspace"] = holders.GetValueOrDefault(name),
                }).ToArray()),
            });
        });

        app.MapPost("/branches", async (HttpRequest request, BranchManager branches, WorkspaceRegistry registry) =>
        {
            var body = await Reply.LenientBody(request);
            var branch = Json.Str(body["branch"]);
            var newBranch = Json.Str(body["new_branch"]);
            if ((branch is not null) == (newBranch is not null)) return Reply.Error(400, "send exactly one of branch or new_branch");
            if (body["start_point"] is { } start && Json.Str(start) is null) return Reply.Error(400, "start_point must be a branch name");
            var startPoint = Json.Str(body["start_point"]);
            try
            {
                var record = await Task.Run(() => branch is not null ? branches.OpenBranch(branch) : branches.CreateBranch(newBranch!, startPoint));
                registry.Register(record.Id, record.Worktree);
                return Reply.Json(record.ToPayload());
            }
            catch (BridgeException error)
            {
                return Reply.Error(error.Status, error.Detail);
            }
        });

        app.MapDelete("/branches/{workspaceId}", async (string workspaceId, HttpRequest request, BranchManager branches, WorkspaceRegistry registry, ConnectionManager connections) =>
        {
            var worktreeToo = request.Query["worktree_too"].ToString().ToLowerInvariant() is "true" or "1" or "yes" or "on";
            try
            {
                var record = await Task.Run(() =>
                {
                    branches.Get(workspaceId);
                    if (worktreeToo) registry.DropLive(workspaceId);
                    return branches.Delete(workspaceId, worktreeToo);
                });
                registry.Unregister(workspaceId);
                await connections.Broadcast(new JsonObject { ["type"] = "branch-removed", ["id"] = workspaceId });
                return Reply.Json(new JsonObject { ["status"] = "deleted", ["id"] = record.Id });
            }
            catch (BridgeException error)
            {
                return Reply.Error(error.Status, error.Detail);
            }
        });
    }
}
