using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>wiki-general status, interactive status, output, cancel and the context bundle; the generate and update runs are not ported.</summary>
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
    private static OnChange StampOnSuccess(Workspace ws, OnChange inner) => (key, state) =>
    {
        if (state.State != "generating" && state.Error is null) WikiGeneral.StampGeneratedCommit(ws);
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

        app.MapPost("/repos/{repoId}/wiki-general/status", async (string repoId, HttpRequest request, WorkspaceRegistry registry, SkillAgents agents) =>
        {
            var ws = registry.Get(repoId);
            var body = await Reply.LenientBody(request);
            var kind = body.ContainsKey("kind") ? Json.Str(body["kind"]) : WikiGeneral.Kind;
            if (kind is not (WikiGeneral.Kind or WikiGeneral.KindUpdate)) return Reply.Error(400, $"unrecognized kind: {Repr(kind)}");
            var agent = agents[kind];
            var other = agents[kind == WikiGeneral.Kind ? WikiGeneral.KindUpdate : WikiGeneral.Kind];
            var (onChange, _) = SkillJobCallbacks.For(WikiGeneral.Kind, ws.Emit);
            onChange = StampOnSuccess(ws, onChange);
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
                    WikiGeneral.Clear(ws.Root);
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

        foreach (var route in new[] { "generate", "update" })
            app.MapPost($"/repos/{{repoId}}/wiki-general/{route}", (string repoId, WorkspaceRegistry registry) =>
                registry.Get(repoId).ReadOnly
                    ? Reply.Error(409, ReadOnlyMessage)
                    : Reply.Error(501, $"wiki-general {route} is not available in the C# bridge yet; run the codechroma-wiki-general skill from an agent window"));

        app.MapGet("/repos/{repoId}/wiki-general-context", (string repoId, WorkspaceRegistry registry) =>
            Reply.Json(WikiGeneral.Context(registry.Get(repoId).Root)));
    }
}
