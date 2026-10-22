using System.Text.Json.Nodes;
using CodeChroma.Bridge.Context;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>wiki-general status, interactive status, generate, update, clustering, output, cancel and the context bundle.</summary>
public static class WikiGeneralRoutes
{
    private const string ReadOnlyMessage = "a pull-request workspace is read-only";

    private static SkillAgent Active(SkillAgents agents, Workspace ws) =>
        agents[WikiGeneral.KindUpdate].GetState(ws.Id).State == "generating" ? agents[WikiGeneral.KindUpdate] : agents[WikiGeneral.Kind];

    private static JsonObject Merge(JobState state, bool has, bool stale, bool empty) => new()
    {
        ["state"] = state.State, ["error"] = state.Error, ["has_wiki_general"] = has, ["stale"] = stale, ["empty"] = empty,
    };

    /// <summary>A clean finish records the commit this tree now reflects before the ping goes out.</summary>
    private static OnChange StampOnSuccess(Workspace ws, OnChange inner, DiagramContext context) => (key, state) =>
    {
        if (state.State != "generating" && state.Error is null)
        {
            WikiGeneral.StampGeneratedCommit(ws);
            _ = Task.Run(() => context.PrepareAsync(ws));
        }
        return inner(key, state);
    };

    private static string Repr(string? value) => value is null ? "None" : $"'{value}'";

    public static void Map(WebApplication app)
    {
        app.MapGet("/repos/{repoId}/wiki-general/status", (string repoId, WorkspaceRegistry registry, SkillAgents agents) =>
        {
            var ws = registry.Get(repoId);
            var manifest = JsonFile.Load(WikiGeneral.ManifestPath(ws.Root));
            var has = WikiGeneral.ValidManifest(manifest);
            var stale = has && WikiGeneral.IsStale(ws, (JsonObject)manifest!);
            var state = Active(agents, ws).GetState(ws.Id);
            return Reply.Json(Merge(state, has, stale, !WikiGeneral.HasDocumentableContent(ws.Root)));
        });

        app.MapPost("/repos/{repoId}/wiki-general/status", async (string repoId, HttpRequest request, WorkspaceRegistry registry, SkillAgents agents, DiagramContext context) =>
        {
            var ws = registry.Get(repoId);
            var body = await Reply.LenientBody(request);
            var kind = body.ContainsKey("kind") ? Json.Str(body["kind"]) : WikiGeneral.Kind;
            if (kind is not (WikiGeneral.Kind or WikiGeneral.KindUpdate)) return Reply.Error(400, $"unrecognized kind: {Repr(kind)}");
            var agent = agents[kind];
            var other = agents[kind == WikiGeneral.Kind ? WikiGeneral.KindUpdate : WikiGeneral.Kind];
            var (onChange, _) = SkillJobCallbacks.For(WikiGeneral.Kind, ws.Emit);
            onChange = StampOnSuccess(ws, onChange, context);
            var state = Json.Str(body["state"]);
            if (state == "generating")
            {
                var gate = WikiGeneral.RunLock(ws.Id);
                await gate.WaitAsync();
                try
                {
                    if (other.GetState(ws.Id).State == "generating")
                        return Reply.Error(409, $"a {(kind == WikiGeneral.Kind ? "update" : "generate")} run is already in progress");
                    if (agent.GetState(ws.Id).State == "generating") return Results.Json(agent.GetState(ws.Id), BridgeJson.Default.JobState);
                    if (kind == WikiGeneral.Kind && !WikiGeneral.HasDocumentableContent(ws.Root))
                        return Results.Json(await agent.MarkDone(ws.Id, onChange, WikiGeneral.NoDocumentableContentError), BridgeJson.Default.JobState);
                    if (await Task.Run(() => WikiGeneral.PrepareNewRun(ws)) is { } syncError)
                        return Results.Json(await agent.MarkDone(ws.Id, onChange, syncError), BridgeJson.Default.JobState);
                    return Results.Json(await agent.MarkGenerating(ws.Id, onChange), BridgeJson.Default.JobState);
                }
                finally
                {
                    gate.Release();
                }
            }
            if (state is "idle" or "error")
            {
                var detail = state == "error" ? Json.Str(body["detail"]) is { Length: > 0 } text ? text : "unspecified error" : null;
                return Results.Json(await agent.MarkDone(ws.Id, onChange, detail), BridgeJson.Default.JobState);
            }
            return Reply.Error(400, $"unrecognized state: {Repr(state)}");
        });

        app.MapGet("/repos/{repoId}/wiki-general/output", (string repoId, WorkspaceRegistry registry, SkillAgents agents) =>
        {
            var ws = registry.Get(repoId);
            return Reply.Json(new JsonObject { ["lines"] = new JsonArray(Active(agents, ws).GetOutput(ws.Id).Select(l => (JsonNode?)l).ToArray()) });
        });

        app.MapPost("/repos/{repoId}/wiki-general/cancel", async (string repoId, WorkspaceRegistry registry, SkillAgents agents) =>
        {
            var ws = registry.Get(repoId);
            if (ws.ReadOnly) return Reply.Error(409, ReadOnlyMessage);
            return Results.Json(await SkillJobCallbacks.StopAndNotify(Active(agents, ws), ws.Id, WikiGeneral.Kind, ws.Emit), BridgeJson.Default.JobState);
        });

        app.MapPost("/repos/{repoId}/wiki-general/generate", async (string repoId, WorkspaceRegistry registry, SkillAgents agents, DiagramContext context) =>
        {
            var ws = registry.Get(repoId);
            if (ws.ReadOnly) return Reply.Error(409, ReadOnlyMessage);
            var agent = agents[WikiGeneral.Kind];
            var (onChange, onOutput) = SkillJobCallbacks.For(WikiGeneral.Kind, ws.Emit);
            onChange = StampOnSuccess(ws, onChange, context);
            var gate = WikiGeneral.RunLock(ws.Id);
            await gate.WaitAsync();
            try
            {
                if (agents[WikiGeneral.KindUpdate].GetState(ws.Id).State == "generating") return Reply.Error(409, "a update run is already in progress");
                if (agent.GetState(ws.Id).State == "generating") return Results.Json(agent.GetState(ws.Id), BridgeJson.Default.JobState);
                if (!WikiGeneral.HasDocumentableContent(ws.Root))
                    return Results.Json(await agent.MarkDone(ws.Id, onChange, WikiGeneral.NoDocumentableContentError), BridgeJson.Default.JobState);
                var syncError = await Task.Run(() => WikiGeneral.PrepareNewRun(ws));
                if (syncError is not null) return Results.Json(await agent.MarkDone(ws.Id, onChange, syncError), BridgeJson.Default.JobState);
                return Results.Json(await agent.Start(ws.Id, ws.Root, onChange, onOutput, workspace: ws), BridgeJson.Default.JobState);
            }
            finally
            {
                gate.Release();
            }
        });

        app.MapPost("/repos/{repoId}/wiki-general/update", async (string repoId, WorkspaceRegistry registry, SkillAgents agents, DiagramContext context) =>
        {
            var ws = registry.Get(repoId);
            if (ws.ReadOnly) return Reply.Error(409, ReadOnlyMessage);
            var agent = agents[WikiGeneral.KindUpdate];
            var (onChange, onOutput) = SkillJobCallbacks.For(WikiGeneral.Kind, ws.Emit);
            onChange = StampOnSuccess(ws, onChange, context);
            var gate = WikiGeneral.RunLock(ws.Id);
            await gate.WaitAsync();
            try
            {
                if (agents[WikiGeneral.Kind].GetState(ws.Id).State == "generating") return Reply.Error(409, "a generate run is already in progress");
                JsonObject delta;
                try
                {
                    delta = await Task.Run(() => WikiGeneralUpdate.ApplyDelta(ws, WikiGeneralUpdate.ComputeDelta(ws)));
                }
                catch (Exception error)
                {
                    // A reanalyze or manifest failure must reach the canvas as an error, not crash the route.
                    return Results.Json(await agent.MarkDone(ws.Id, onChange, error.Message), BridgeJson.Default.JobState);
                }
                string Dump(string level, string bucket) => delta[level]![bucket]!.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
                var prompt = Prompts.Render("wiki_general_update_agent",
                    ("created_components_json", Dump("components", "created")), ("rewritten_components_json", Dump("components", "rewritten")),
                    ("created_containers_json", Dump("containers", "created")), ("rewritten_containers_json", Dump("containers", "rewritten")));
                var pages = WikiGeneralUpdate.PagesToWrite(delta);
                var startedUtc = DateTime.UtcNow.AddSeconds(-1);
                var options = new RunOptions([]) { PostRunCheck = () => WikiGeneralUpdate.VerifyPagesWritten(ws.Root, pages, startedUtc) };
                return Results.Json(await agent.Start(ws.Id, ws.Root, onChange, onOutput, prompt, options: options), BridgeJson.Default.JobState);
            }
            finally
            {
                gate.Release();
            }
        });

        app.MapGet("/repos/{repoId}/wiki-general/update-plan", (string repoId, WorkspaceRegistry registry) =>
            Reply.Guard(() => Reply.Json(WikiGeneralUpdate.ComputeDelta(registry.Get(repoId)))));

        // For a skill run in a terminal: applies the deletions and flips the job to generating with no subprocess.
        app.MapPost("/repos/{repoId}/wiki-general/update-plan", async (string repoId, WorkspaceRegistry registry, SkillAgents agents, DiagramContext context) =>
        {
            var ws = registry.Get(repoId);
            if (ws.ReadOnly) return Reply.Error(409, ReadOnlyMessage);
            var agent = agents[WikiGeneral.KindUpdate];
            var (onChange, _) = SkillJobCallbacks.For(WikiGeneral.Kind, ws.Emit);
            onChange = StampOnSuccess(ws, onChange, context);
            var gate = WikiGeneral.RunLock(ws.Id);
            await gate.WaitAsync();
            try
            {
                if (agents[WikiGeneral.Kind].GetState(ws.Id).State == "generating") return Reply.Error(409, "a generate run is already in progress");
                if (agent.GetState(ws.Id).State == "generating") return Reply.Error(409, "an update run is already in progress");
                JsonObject delta;
                try
                {
                    delta = await Task.Run(() => WikiGeneralUpdate.ApplyDelta(ws, WikiGeneralUpdate.ComputeDelta(ws)));
                }
                catch (Exception error)
                {
                    await agent.MarkDone(ws.Id, onChange, error.Message);
                    return Reply.Error(500, error.Message);
                }
                var state = await agent.MarkGenerating(ws.Id, onChange);
                return Reply.Json(new JsonObject { ["state"] = state.State, ["error"] = state.Error, ["delta"] = delta.DeepClone() });
            }
            finally
            {
                gate.Release();
            }
        });

        app.MapGet("/repos/{repoId}/wiki-general/clustering", (string repoId, WorkspaceRegistry registry) =>
            Reply.Guard(() =>
            {
                var ws = registry.Get(repoId);
                var result = ws.Engine.BuildClusters(ws.Root) ?? throw new BridgeException(409, "the engine has no graph to cluster");
                return Reply.Json(WikiGeneralUpdate.ClusteringBody(result));
            }));

        app.MapGet("/repos/{repoId}/wiki-general-context", (string repoId, WorkspaceRegistry registry) =>
            Reply.Json(WikiGeneral.Context(registry.Get(repoId).Root)));
    }
}
