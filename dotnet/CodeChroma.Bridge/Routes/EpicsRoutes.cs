using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Epics;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>The epics item route and the AI-brief quartet (start/attach, poll, cancel, progress), plus the per-epic paths.</summary>
public static partial class EpicsRoutes
{
    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")] private static partial Regex EpicId();

    /// <summary>An epic id names one path segment on disk, so it must never escape the per-epic diagrams dir.</summary>
    public static bool ValidEpicId(string id) => EpicId().IsMatch(id);

    private static IResult Unknown(string itemId) => Reply.Error(404, $"unknown work item: '{itemId}'");

    private static JsonObject? ReadBrief(Workspace ws, string key, JsonObject? epic)
    {
        var data = JsonFile.Load(EpicBrief.BriefPath(ws.Root, key)) as JsonObject;
        if (data is null) return null;
        if (epic is not null) data = EpicBrief.Resolve(data, ws.Root, epic);
        return EpicBrief.Normalize(data);
    }

    private static JsonObject Envelope(string key, JsonObject? brief, JobState state) => new()
    {
        ["job_key"] = key, ["brief"] = brief, ["state"] = state.State, ["error"] = state.Error,
    };

    public static void Map(WebApplication app)
    {
        app.MapGet("/repos/{repoId}/epics/items/{itemId}", (string repoId, string itemId, string? expand, WorkspaceRegistry registry) =>
            EpicsAssembler.For(registry.Get(repoId).Root).Item(itemId, expand) is { } item ? Reply.Json(item) : Unknown(itemId));

        app.MapPost("/repos/{repoId}/epics/{itemId}/brief", async (string repoId, string itemId, bool? force, WorkspaceRegistry registry, SkillAgents agents) =>
        {
            var ws = registry.Get(repoId);
            if (ws.ReadOnly) return Reply.Error(409, "a pull-request workspace is read-only");
            if (EpicsAssembler.For(ws.Root).Item(itemId) is not { } epic) return Unknown(itemId);
            var key = EpicBrief.JobKey(ws.Id, itemId);
            var agent = agents["epic-brief"];
            // Attach to an in-flight run first: a cached brief must not bypass the generate guard.
            if (agent.GetState(key) is { State: "generating" } live) return Reply.Json(Envelope(key, null, live));
            if (force != true && await Task.Run(() => ReadBrief(ws, key, epic)) is { } cached)
                return Reply.Json(Envelope(key, cached, new JobState("idle", null)));
            var extras = new JsonObject { ["job_key"] = key, ["item_id"] = itemId };
            var (onChange, onOutput) = SkillJobCallbacks.For("epic-brief", ws.Emit, extras);
            var bundle = await Task.Run(() => EpicBrief.BuildBundle(ws.Root, itemId, epic, EpicBrief.BriefPath(ws.Root, key)));
            var prompt = Prompts.Render("epic_brief_agent", ("epic_id", itemId), ("job_key", key), ("bundle", bundle.ToJsonString()));
            var state = await agent.Start(key, ws.Root, onChange, onOutput, prompt);
            return Reply.Json(Envelope(key, null, state));
        });

        app.MapGet("/repos/{repoId}/epics/{itemId}/brief", (string repoId, string itemId, WorkspaceRegistry registry, SkillAgents agents) =>
        {
            var ws = registry.Get(repoId);
            var key = EpicBrief.JobKey(ws.Id, itemId);
            var state = agents["epic-brief"].GetState(key);
            // Skipped mid-run: the file is absent or half-written then anyway.
            var brief = state.State == "generating" ? null : ReadBrief(ws, key, EpicsAssembler.For(ws.Root).Item(itemId));
            return Reply.Json(Envelope(key, brief, state));
        });

        app.MapPost("/repos/{repoId}/epics/{itemId}/brief/cancel", async (string repoId, string itemId, WorkspaceRegistry registry, SkillAgents agents) =>
        {
            var ws = registry.Get(repoId);
            var key = EpicBrief.JobKey(ws.Id, itemId);
            var extras = new JsonObject { ["job_key"] = key, ["item_id"] = itemId };
            var state = await SkillJobCallbacks.StopAndNotify(agents["epic-brief"], key, "epic-brief", ws.Emit, extras);
            var brief = await Task.Run(() => ReadBrief(ws, key, EpicsAssembler.For(ws.Root).Item(itemId)));
            return Reply.Json(Envelope(key, brief, state));
        });

        app.MapGet("/repos/{repoId}/epics/{itemId}/brief/output", (string repoId, string itemId, WorkspaceRegistry registry, SkillAgents agents) =>
            Reply.Json(new JsonObject { ["lines"] = new JsonArray(agents["epic-brief"].GetOutput(EpicBrief.JobKey(registry.Get(repoId).Id, itemId)).Select(l => (JsonNode?)l).ToArray()) }));

        app.MapGet("/repos/{repoId}/epics/{itemId}/brief/path", (string repoId, string itemId, WorkspaceRegistry registry) =>
        {
            var ws = registry.Get(repoId);
            return Reply.Json(new JsonObject
            {
                ["repo_root"] = ws.Root,
                ["brief_path"] = EpicBrief.BriefPath(ws.Root, EpicBrief.JobKey(ws.Id, itemId)).Replace('\\', '/'),
            });
        });

        app.MapGet("/repos/{repoId}/epics/{itemId}/diagram-path", (string repoId, string itemId, WorkspaceRegistry registry) =>
        {
            if (!ValidEpicId(itemId)) return Unknown(itemId);
            var ws = registry.Get(repoId);
            return Reply.Json(new JsonObject { ["repo_root"] = ws.Root, ["diagram_path"] = ws.DiagramPath($"epics/{itemId}").Replace('\\', '/') });
        });
    }
}
