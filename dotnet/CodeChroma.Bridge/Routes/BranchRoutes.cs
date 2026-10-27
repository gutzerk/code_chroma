using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Live;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>Worktree tabs: each br_* record is one worktree on its own branch; agents, diagrams and artifacts belong to a tab.</summary>
public static class BranchRoutes
{
    public static void Map(WebApplication app, string repoRoot)
    {
        app.MapGet("/branches", (BranchManager branches) => Reply.GuardBlocking(() => Reply.Json(Listing(branches, branches.ActiveId))));

        app.MapPost("/branches/ensure", (BranchManager branches, WorkspaceRegistry registry) => Reply.GuardAsync(async () =>
        {
            var (_, active) = await Task.Run(branches.EnsureAny);
            await Task.Run(() => RegisterAll(branches, registry));
            return Reply.Json(Listing(branches, active));
        }));

        app.MapPost("/branches/new", (HttpRequest request, BranchManager branches, WorkspaceRegistry registry) => Reply.GuardAsync(async () =>
        {
            var body = await Reply.LenientBody(request);
            if (body["name"] is { } rawName && Json.Str(rawName) is null) return Reply.Error(400, "name must be a string");
            var (record, fetched, warning) = await Task.Run(() => branches.CreateNext(Json.Str(body["name"])));
            registry.Register(record.Id, record.Worktree);
            return Reply.Json(new JsonObject
            {
                ["branch"] = branches.Payload(record),
                ["fetched"] = fetched,
                ["warning"] = warning,
            });
        }));

        app.MapPatch("/branches/{workspaceId}", (string workspaceId, HttpRequest request, BranchManager branches, AgentManager agents) => Reply.GuardAsync(async () =>
        {
            var body = await Reply.LenientBody(request);
            if (Json.Str(body["name"]) is not { Length: > 0 } name) return Reply.Error(400, "name is required");
            var record = await Task.Run(() =>
            {
                var renamed = branches.Rename(workspaceId, name);
                agents.RenameBranch(workspaceId, renamed.Branch);
                return renamed;
            });
            return Reply.Json(branches.Payload(record));
        }));

        app.MapPut("/branches/active", (HttpRequest request, BranchManager branches) => Reply.GuardAsync(async () =>
        {
            var body = await Reply.LenientBody(request);
            if (Json.Str(body["id"]) is not { Length: > 0 } id) return Reply.Error(400, "id is required");
            await Task.Run(() => branches.SetActive(id));
            return Reply.Json(new JsonObject { ["active"] = id });
        }));

        app.MapDelete("/branches/{workspaceId}", (string workspaceId, HttpRequest request, BranchManager branches, AgentManager agents, AgentSessionRegistry sessions, WorkspaceRegistry registry, ConnectionManager connections) => Reply.GuardAsync(async () =>
        {
            var worktreeToo = request.Query["worktree_too"].ToString().ToLowerInvariant() is "true" or "1" or "yes" or "on";
            await Task.Run(() => branches.Get(workspaceId));
            foreach (var agent in agents.AttachedToWorkspace(workspaceId))
            {
                sessions.Stop(agent.Id);
                await Task.Run(() => agents.Delete(agent.Id));
                registry.Unregister(agent.Id);
                await connections.Broadcast(new JsonObject { ["type"] = "agent-removed", ["id"] = agent.Id });
            }
            var record = await Task.Run(() =>
            {
                if (worktreeToo) registry.DropLive(workspaceId);
                return branches.Delete(workspaceId, worktreeToo);
            });
            registry.Unregister(workspaceId);
            await connections.Broadcast(new JsonObject { ["type"] = "branch-removed", ["id"] = workspaceId });
            return Reply.Json(new JsonObject { ["status"] = "deleted", ["id"] = record.Id });
        }));
    }

    private static JsonObject Listing(BranchManager branches, string? active) => new()
    {
        ["branches"] = new JsonArray(branches.Payloads(branches.List()).Select(p => (JsonNode?)p).ToArray()),
        ["active"] = active,
    };

    private static void RegisterAll(BranchManager branches, WorkspaceRegistry registry)
    {
        foreach (var record in branches.List())
            if (!registry.IsRegistered(record.Id) && Directory.Exists(record.Worktree)) registry.Register(record.Id, record.Worktree);
    }
}
