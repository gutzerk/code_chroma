using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
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

        foreach (var kind in SkillJobs.Kinds)
        {
            var k = kind;
            app.MapGet($"/repos/{{repoId}}/{k}/status", (string repoId, WorkspaceRegistry r) =>
                Results.Json(r.Get(repoId).Jobs.Get(k), BridgeJson.Default.JobState));
            app.MapGet($"/repos/{{repoId}}/{k}/output", (string repoId, WorkspaceRegistry r) =>
                Results.Json(new JobOutput(r.Get(repoId).Jobs.Output(k)), BridgeJson.Default.JobOutput));
            app.MapPost($"/repos/{{repoId}}/{k}/status", async (string repoId, HttpRequest request, WorkspaceRegistry r) =>
                await SetStatus(r.Get(repoId), k, request));
            app.MapPost($"/repos/{{repoId}}/{k}/cancel", (string repoId, WorkspaceRegistry r) =>
            {
                var ws = r.Get(repoId);
                return Emit(ws, k, ws.Jobs.Stop(k));
            });
        }
    }

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

    private static IResult Emit(Workspace ws, string kind, JobState state)
    {
        ws.Emit(new JsonObject { ["type"] = $"{kind}-status", ["state"] = state.State, ["error"] = state.Error });
        return Results.Json(state, BridgeJson.Default.JobState);
    }

    /// <summary>Lenient body read: anything that is not a JSON object is an empty one.</summary>
    private static async Task<JsonObject> LenientBody(HttpRequest request)
    {
        try
        {
            return await JsonNode.ParseAsync(request.Body) as JsonObject ?? new JsonObject();
        }
        catch (JsonException)
        {
            return new JsonObject();
        }
    }

    private static async Task<IResult> SetStatus(Workspace ws, string kind, HttpRequest request)
    {
        var body = await LenientBody(request);
        var state = body["state"] is JsonValue v && v.TryGetValue(out string? s) ? s : null;
        switch (state)
        {
            case "generating":
                return Emit(ws, kind, ws.Jobs.MarkGenerating(kind));
            case "idle":
                return Emit(ws, kind, ws.Jobs.MarkDone(kind, null));
            case "error":
                var detail = body["detail"] is JsonValue d && d.TryGetValue(out string? text) && text.Length > 0 ? text : "unspecified error";
                return Emit(ws, kind, ws.Jobs.MarkDone(kind, detail));
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
