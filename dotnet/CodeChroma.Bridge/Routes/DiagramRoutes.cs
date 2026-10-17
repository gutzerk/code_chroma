using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
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
        foreach (var kind in Workspace.DiagramKinds)
        {
            var k = kind;
            app.MapGet($"/repos/{{repoId}}/{k}-path", (string repoId, WorkspaceRegistry registry) =>
            {
                var ws = registry.Get(repoId);
                return Results.Json(new JsonObject { ["repo_root"] = ws.Root, [$"{k}_path"] = ws.DiagramPath(k) }, BridgeJson.Default.JsonObject);
            });
            app.MapGet($"/repos/{{repoId}}/{k}", (string repoId, WorkspaceRegistry registry) =>
                Results.Json(LoadArtifact(registry.Get(repoId), k) ?? new JsonObject(), BridgeJson.Default.JsonObject));
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
            app.MapPost($"/repos/{{repoId}}/{k}/generate", async (string repoId, HttpRequest request, WorkspaceRegistry r, SkillAgents agents) =>
            {
                var ws = r.Get(repoId);
                var agent = agents[k];
                var onlyIfMissing = request.Query["only_if_missing"].ToString().Equals("true", StringComparison.OrdinalIgnoreCase);
                if (onlyIfMissing && k == "c1" && agent.HasArtifact(ws.Root, ws.Id)) return Results.Json(agent.GetState(ws.Id), BridgeJson.Default.JobState);
                var (onChange, onOutput) = SkillJobCallbacks.For(k, ws.Emit);
                return Results.Json(await agent.Start(ws.Id, ws.Root, onChange, onOutput), BridgeJson.Default.JobState);
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

    public static JsonNode? LoadArtifact(Workspace ws, string kind)
    {
        try
        {
            return JsonNode.Parse(File.ReadAllText(ws.DiagramPath(kind)));
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

    private static string? Fingerprint(JsonNode? diagram)
    {
        if (diagram is not JsonObject { Count: > 0 }) return null;
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Canonical(diagram)))).ToLowerInvariant()[..16];
    }

    private static string Canonical(JsonNode? node) => node switch
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
        void Add(string key, JsonNode? diagram) => result[key] = new JsonObject
        {
            ["ready"] = diagram is JsonObject { Count: > 0 },
            ["fingerprint"] = Fingerprint(diagram),
        };
        foreach (var kind in Workspace.DiagramKinds) Add(kind, LoadArtifact(ws, kind));
        foreach (var entry in library.ListTypes())
            if (Json.Str(entry!["id"]) is { } typeId) Add($"custom/{typeId}", LoadArtifact(ws, $"custom/{typeId}"));
        var featureDir = Path.Combine(ws.Root, ".codechroma", "diagrams", "feature-plan");
        if (Directory.Exists(featureDir))
            foreach (var dir in Directory.GetDirectories(featureDir).Select(Path.GetFileName).Order(StringComparer.Ordinal))
            {
                var diagram = LoadArtifact(ws, $"feature-plan/{dir}");
                if (diagram is JsonObject { Count: > 0 }) Add($"feature-plan/{dir}", diagram);
            }
        return Results.Json(result, BridgeJson.Default.JsonObject);
    }
}
