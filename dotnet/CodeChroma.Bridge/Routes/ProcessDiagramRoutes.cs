using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>Headless, context-free generation of a saved custom diagram type from a free-text request (the fast process-diagram path).</summary>
public static class ProcessDiagramRoutes
{
    public static void Map(WebApplication app)
    {
        app.MapPost("/repos/{repoId}/custom/{typeId}/generate", async (string repoId, string typeId, HttpRequest http, WorkspaceRegistry registry, ProcessDiagram diagram) =>
        {
            if (!DiagramLibrary.ValidTypeId(typeId)) return Reply.Error(400, $"invalid diagram type id: {typeId}");
            var body = await Reply.LenientBody(http);
            if (Json.Str(body["request"]) is not { } request || Json.IsBlank(request)) return Reply.Error(400, "request is required");
            var ws = registry.Get(repoId);
            var (onChange, onOutput) = SkillJobCallbacks.For("custom", ws.Emit, new System.Text.Json.Nodes.JsonObject { ["type_id"] = typeId });
            return Results.Json(await diagram.Start(ws, typeId, request, onChange, onOutput), BridgeJson.Default.JobState);
        });

        app.MapGet("/repos/{repoId}/custom/{typeId}/generate/status", (string repoId, string typeId, WorkspaceRegistry registry, SkillAgents agents) =>
            Results.Json(agents[ProcessDiagram.Kind].GetState(ProcessDiagram.JobKey(registry.Get(repoId).Id, typeId)), BridgeJson.Default.JobState));

        app.MapGet("/repos/{repoId}/custom/{typeId}/generate/output", (string repoId, string typeId, WorkspaceRegistry registry, SkillAgents agents) =>
            Results.Json(new JobOutput(agents[ProcessDiagram.Kind].GetOutput(ProcessDiagram.JobKey(registry.Get(repoId).Id, typeId))), BridgeJson.Default.JobOutput));

        app.MapPost("/repos/{repoId}/custom/{typeId}/generate/cancel", async (string repoId, string typeId, WorkspaceRegistry registry, SkillAgents agents) =>
        {
            var ws = registry.Get(repoId);
            var extras = new System.Text.Json.Nodes.JsonObject { ["type_id"] = typeId };
            return await SkillJobCallbacks.StopAndNotify(agents[ProcessDiagram.Kind], ProcessDiagram.JobKey(ws.Id, typeId), "custom", ws.Emit, extras);
        });
    }
}
