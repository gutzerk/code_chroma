using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Context;
using CodeChroma.Bridge.Diagrams;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>Per-diagram artifact routes (path, read, delete), readiness, and the skill-job status machine.</summary>
public static class DiagramRoutes
{
    public static void Map(WebApplication app)
    {
        var parser = DiffRoutes.ParserFor(app);
        foreach (var kind in Workspace.DiagramKinds)
        {
            var k = kind;
            app.MapGet($"/repos/{{repoId}}/{k}-path", (string repoId, WorkspaceRegistry registry) =>
            {
                var ws = registry.Get(repoId);
                return Results.Json(new JsonObject { ["repo_root"] = ws.Root, [$"{k}_path"] = ws.DiagramPath(k) }, BridgeJson.Default.JsonObject);
            });
            app.MapGet($"/repos/{{repoId}}/{k}", (string repoId, WorkspaceRegistry registry) =>
                Results.Json(ResolveKind(registry.Get(repoId), k, parser), BridgeJson.Default.JsonObject));
            app.MapDelete($"/repos/{{repoId}}/{k}", (string repoId, WorkspaceRegistry registry) =>
            {
                var path = registry.Get(repoId).DiagramPath(k);
                var existed = File.Exists(path);
                if (existed) File.Delete(path);
                return Results.Json(new JsonObject { ["deleted"] = existed }, BridgeJson.Default.JsonObject);
            });
        }

        app.MapGet("/repos/{repoId}/diagrams/status", DiagramsStatus);

        foreach (var kind in GenerateKinds)
        {
            var k = kind;
            app.MapPost($"/repos/{{repoId}}/{k}/generate", async (string repoId, HttpRequest request, WorkspaceRegistry r, SkillAgents agents, DiagramContext context) =>
            {
                var ws = r.Get(repoId);
                var agent = agents[k];
                var onlyIfMissing = request.Query["only_if_missing"].ToString().Equals("true", StringComparison.OrdinalIgnoreCase);
                if (onlyIfMissing && k == "c1" && agent.HasArtifact(ws.C1Root, ws.Id)) return Results.Json(agent.GetState(ws.Id), BridgeJson.Default.JobState);
                var (onChange, onOutput) = SkillJobCallbacks.For(k, ws.Emit);
                var gathered = DiagramContext.Types.Contains(k) ? await context.GatherAsync(ws, k, null) : null;
                return Results.Json(await agent.Start(ws.Id, ws.Root, onChange, onOutput, options: gathered is null ? null : new RunOptions([]) { Context = gathered }), BridgeJson.Default.JobState);
            });
            app.MapGet($"/repos/{{repoId}}/{k}/status", (string repoId, WorkspaceRegistry r, SkillAgents agents) =>
                Results.Json(agents[k].GetState(r.Get(repoId).Id), BridgeJson.Default.JobState));
            app.MapGet($"/repos/{{repoId}}/{k}/output", (string repoId, WorkspaceRegistry r, SkillAgents agents) =>
                Results.Json(new JobOutput(agents[k].GetOutput(r.Get(repoId).Id)), BridgeJson.Default.JobOutput));
            app.MapPost($"/repos/{{repoId}}/{k}/status", async (string repoId, HttpRequest request, WorkspaceRegistry r, SkillAgents agents) =>
                await SetStatus(r.Get(repoId), agents[k], k, request));
            app.MapPost($"/repos/{{repoId}}/{k}/cancel", async (string repoId, WorkspaceRegistry r, SkillAgents agents) =>
            {
                var ws = r.Get(repoId);
                return await SkillJobCallbacks.StopAndNotify(agents[k], ws.Id, k, ws.Emit);
            });
        }
    }

    /// <summary>The kinds with a generate/status/output/cancel quartet (c1, and the Impact change review).</summary>
    public static readonly IReadOnlyList<string> GenerateKinds = ["c1", "impact-changes"];

    /// <summary>One built-in kind's resolved payload, with the impact "changes" overlay attached.</summary>
    public static JsonObject ResolveKind(Workspace ws, string kind, IOldSymbolParser parser)
    {
        var data = DiagramArtifacts.Load(ws, kind);
        switch (kind)
        {
            case "c1":
                if (data.Count == 0) return new JsonObject();
                data["type"] = "c1";
                return DiagramResolver.AttachCoverage(DiagramResolver.Resolve(ws.Engine, data), ws.Engine);
            case "epics":
                var epics = DiagramResolver.Resolve(ws.Engine, data);
                epics["has_diagram"] = data.Count > 0;
                return epics;
            case "patterns":
                return PatternsResolver.Resolve(ws.Engine, data);
            case "impact":
                return ImpactChanges.AttachOverlay(ws, parser, ImpactResolver.Resolve(ws));
            case "sequence":
                if (data.Count == 0) return new JsonObject();
                data["type"] = "sequence";
                // A participant may message itself, so the sequence style applies even when the file omits it.
                var sequence = DiagramResolver.Resolve(ws.Engine, data, data["style"] ?? JsonValue.Create("sequence"), "sequence");
                sequence["has_diagram"] = true;
                return sequence;
            default:
                return LoadArtifact(ws, kind) as JsonObject ?? new JsonObject();
        }
    }

    public static JsonNode? LoadArtifact(Workspace ws, string kind) => LoadArtifactAt(kind == "c1" ? ws.C1Root : ws.Root, kind);

    private static JsonNode? LoadArtifactAt(string root, string kind)
    {
        try
        {
            return JsonNode.Parse(File.ReadAllText(Workspace.DiagramPath(root, kind)));
        }
        catch (Exception error) when (error is IOException or JsonException)
        {
            return null;
        }
    }

    private static async Task<IResult> SetStatus(Workspace ws, SkillAgent agent, string kind, HttpRequest request)
    {
        var body = await Reply.LenientBody(request);
        var state = Json.Str(body["state"]);
        var (onChange, _) = SkillJobCallbacks.For(kind, ws.Emit);
        switch (state)
        {
            case "generating":
                return Results.Json(await agent.MarkGenerating(ws.Id, onChange), BridgeJson.Default.JobState);
            case "idle":
                return Results.Json(await agent.MarkDone(ws.Id, onChange), BridgeJson.Default.JobState);
            case "error":
                var detail = Json.Str(body["detail"]) is { Length: > 0 } text ? text : "unspecified error";
                return Results.Json(await agent.MarkDone(ws.Id, onChange, detail), BridgeJson.Default.JobState);
        }
        var shown = state is null ? "None" : $"'{state}'";
        return Results.Json(new ErrorDetail($"unrecognized state: {shown}"), BridgeJson.Default.ErrorDetail, statusCode: 400);
    }

    public static string? Fingerprint(JsonNode? diagram)
    {
        if (diagram is not JsonObject { Count: > 0 }) return null;
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Canonical(diagram)))).ToLowerInvariant()[..16];
    }

    internal static string Canonical(JsonNode? node) => node switch
    {
        JsonObject o => "{" + string.Join(",", o.OrderBy(kv => kv.Key, StringComparer.Ordinal).Select(kv => $"\"{kv.Key}\":{Canonical(kv.Value)}")) + "}",
        JsonArray a => "[" + string.Join(",", a.Select(Canonical)) + "]",
        null => "null",
        _ => node.ToJsonString(),
    };

    private static IResult DiagramsStatus(string repoId, WorkspaceRegistry registry, DiagramLibrary library)
    {
        var ws = registry.Get(repoId);
        var result = new JsonObject();
        void Add(string key, JsonNode? diagram, bool? ready = null) => result[key] = new JsonObject
        {
            ["ready"] = ready ?? diagram is JsonObject { Count: > 0 },
            ["fingerprint"] = Fingerprint(diagram),
        };
        // A built-in is ready once its file validates (an empty object is valid); custom and feature-plan once non-empty.
        foreach (var kind in Workspace.DiagramKinds) Add(kind, DiagramArtifacts.Load(ws, kind), SkillAgents.HasValidFlatDiagram(LoadArtifact(ws, kind)));
        foreach (var entry in library.ListTypes())
            if (Json.Str(entry!["id"]) is { } typeId) Add($"custom/{typeId}", DiagramArtifacts.Load(ws, $"custom/{typeId}"));
        var featureDir = Path.Combine(ws.Root, ".codechroma", "diagrams", "feature-plan");
        if (Directory.Exists(featureDir))
            foreach (var dir in Directory.GetDirectories(featureDir).Select(Path.GetFileName).Order(StringComparer.Ordinal))
            {
                var diagram = DiagramArtifacts.Load(ws, $"feature-plan/{dir}");
                if (diagram is JsonObject { Count: > 0 }) Add($"feature-plan/{dir}", diagram);
            }
        return Results.Json(result, BridgeJson.Default.JsonObject);
    }
}
