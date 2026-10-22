using System.Collections.Concurrent;
using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Agents;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workflows;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>One WorkflowRunner per workspace, created on first use and wired to that workspace's event socket.</summary>
public sealed class WorkflowRunners(SkillAgents agents, IServer server, AgentManager agentManager)
{
    private readonly ConcurrentDictionary<string, WorkflowRunner> _runners = new();

    public WorkflowRunner For(Workspace ws) =>
        _runners.GetOrAdd(ws.Id, _ => new WorkflowRunner(ws.Root, agents["workflow-step"], ws.Emit, null, agents["workflow-chat"], runId => McpUrl(ws.Id, runId), reserveCleanup: agentManager.ReserveRunCleanup));

    /// <summary>Where the run agent's CLI reaches this bridge's per-run MCP endpoint, or null before the server is listening.</summary>
    private string? McpUrl(string repoId, string runId)
    {
        if (BridgeAddress.Local(server) is not { } local) return null;
        return $"{local}/mcp/runs/{Uri.EscapeDataString(repoId)}/{Uri.EscapeDataString(runId)}";
    }
}

/// <summary>Workflow definitions, runs and the steer commands (stop, pause, breakpoints, review).</summary>
public static class WorkflowRoutes
{
    private static IResult JsonResult(object value) =>
        Results.Text(JsonSerializer.Serialize(value, WorkflowJson.Options), "application/json; charset=utf-8");

    public static void Map(WebApplication app)
    {
        app.MapGet("/repos/{repoId}/workflows", (string repoId, WorkspaceRegistry registry, WorkflowRunners runners) =>
            JsonResult(runners.For(registry.Get(repoId)).Store.ListWorkflows()));

        app.MapPost("/repos/{repoId}/workflows", async (string repoId, HttpRequest request, WorkspaceRegistry registry, WorkflowRunners runners, SkillAgents agents, CliResolver resolver) =>
        {
            var ws = registry.Get(repoId);
            if (ws.ReadOnly) return Reply.Error(409, "a pull-request workspace is read-only");
            var (def, error) = await ReadDefinition(request, agents, resolver);
            if (def is null) return Reply.Error(400, error!);
            var store = runners.For(registry.Get(repoId)).Store;
            if (!store.TryCreateWorkflow(def)) return Reply.Error(409, "Workflow already exists");
            return JsonResult(def);
        });

        app.MapPut("/repos/{repoId}/workflows/{workflowId}", async (string repoId, string workflowId, HttpRequest request, WorkspaceRegistry registry, WorkflowRunners runners, SkillAgents agents, CliResolver resolver) =>
        {
            var ws = registry.Get(repoId);
            if (ws.ReadOnly) return Reply.Error(409, "a pull-request workspace is read-only");
            var (def, error) = await ReadDefinition(request, agents, resolver);
            if (def is null) return Reply.Error(400, error!);
            if (def.Id != workflowId) return Reply.Error(400, "The workflow id in the body must match the URL");
            var store = runners.For(ws).Store;
            if (store.GetWorkflow(workflowId) is null) return Reply.Error(404, $"unknown workflow: {workflowId}");
            store.SaveWorkflow(def);
            return JsonResult(def);
        });

        app.MapDelete("/repos/{repoId}/workflows/{workflowId}", (string repoId, string workflowId, WorkspaceRegistry registry, WorkflowRunners runners) =>
            Mutate(registry.Get(repoId), runners, runner =>
            {
                runner.DeleteWorkflow(workflowId);
                return new { deleted = workflowId };
            }));

        app.MapGet("/repos/{repoId}/skills", (string repoId, WorkspaceRegistry registry) =>
            JsonResult(ListSkills(registry.Get(repoId).Root)));

        app.MapGet("/repos/{repoId}/runs", (string repoId, WorkspaceRegistry registry, WorkflowRunners runners) =>
            JsonResult(runners.For(registry.Get(repoId)).List()));

        app.MapGet("/repos/{repoId}/runs/{runId}", (string repoId, string runId, WorkspaceRegistry registry, WorkflowRunners runners) =>
            Reply.Guard(() => JsonResult(runners.For(registry.Get(repoId)).Get(runId))));

        app.MapPost("/repos/{repoId}/workflows/{workflowId}/runs", async (string repoId, string workflowId, HttpRequest request, WorkspaceRegistry registry, WorkflowRunners runners) =>
        {
            var body = await Reply.LenientBody(request);
            var inputs = new Dictionary<string, string>();
            if (body["inputs"] is JsonObject raw)
                foreach (var (name, value) in raw)
                    if (Json.NonEmptyStr(value) is { } text) inputs[name] = text;
            return await MutateAsync(registry.Get(repoId), runners, runner => runner.Start(workflowId, inputs));
        });

        app.MapDelete("/repos/{repoId}/runs/{runId}", (string repoId, string runId, WorkspaceRegistry registry, WorkflowRunners runners) =>
            Mutate(registry.Get(repoId), runners, runner =>
            {
                runner.DeleteRun(runId);
                return new { deleted = runId };
            }));

        app.MapDelete("/repos/{repoId}/runs", (string repoId, string? state, WorkspaceRegistry registry, WorkflowRunners runners) =>
            state != "finished"
                ? Reply.Error(400, "state must be finished")
                : Mutate(registry.Get(repoId), runners, runner => new { deleted = runner.ClearFinished() }));

        app.MapPost("/repos/{repoId}/runs/{runId}/restart", async (string repoId, string runId, WorkspaceRegistry registry, WorkflowRunners runners) =>
            await MutateAsync(registry.Get(repoId), runners, runner => runner.Restart(runId)));

        app.MapPost("/repos/{repoId}/runs/{runId}/skip", async (string repoId, string runId, HttpRequest request, WorkspaceRegistry registry, WorkflowRunners runners) =>
        {
            var body = await Reply.LenientBody(request);
            if (Str(body, "stepId") is not { } stepId) return Reply.Error(400, "stepId is required");
            return Mutate(registry.Get(repoId), runners, runner => runner.Skip(runId, stepId));
        });

        app.MapPost("/repos/{repoId}/runs/{runId}/pause", (string repoId, string runId, WorkspaceRegistry registry, WorkflowRunners runners) =>
            Mutate(registry.Get(repoId), runners, runner => runner.Pause(runId)));

        app.MapPost("/repos/{repoId}/runs/{runId}/resume", (string repoId, string runId, WorkspaceRegistry registry, WorkflowRunners runners) =>
            Mutate(registry.Get(repoId), runners, runner => runner.Resume(runId)));

        app.MapPost("/repos/{repoId}/runs/{runId}/keep-running", (string repoId, string runId, WorkspaceRegistry registry, WorkflowRunners runners) =>
            Mutate(registry.Get(repoId), runners, runner => runner.KeepRunning(runId)));

        app.MapPost("/repos/{repoId}/runs/{runId}/stop", async (string repoId, string runId, HttpRequest request, WorkspaceRegistry registry, WorkflowRunners runners) =>
        {
            var body = await Reply.LenientBody(request);
            var mode = Str(body, "mode") ?? "now";
            return await MutateAsync(registry.Get(repoId), runners, runner => runner.Stop(runId, mode));
        });

        app.MapPost("/repos/{repoId}/runs/{runId}/breakpoints", async (string repoId, string runId, HttpRequest request, WorkspaceRegistry registry, WorkflowRunners runners) =>
        {
            var body = await Reply.LenientBody(request);
            if (Str(body, "stepId") is not { } stepId) return Reply.Error(400, "stepId is required");
            var on = Json.Bool(body["on"]);
            return Mutate(registry.Get(repoId), runners, runner => runner.SetBreakpoint(runId, stepId, on));
        });

        app.MapPost("/repos/{repoId}/runs/{runId}/resume-from", async (string repoId, string runId, HttpRequest request, WorkspaceRegistry registry, WorkflowRunners runners) =>
        {
            var body = await Reply.LenientBody(request);
            if (Str(body, "stepId") is not { } stepId) return Reply.Error(400, "stepId is required");
            return Mutate(registry.Get(repoId), runners, runner => runner.ResumeFrom(runId, stepId));
        });

        app.MapPost("/repos/{repoId}/runs/{runId}/review", async (string repoId, string runId, HttpRequest request, WorkspaceRegistry registry, WorkflowRunners runners) =>
        {
            var body = await Reply.LenientBody(request);
            var decision = Str(body, "decision") ?? "";
            return await MutateAsync(registry.Get(repoId), runners, runner => runner.Review(runId, decision, Str(body, "note")));
        });

        app.MapPost("/repos/{repoId}/runs/{runId}/message", async (string repoId, string runId, HttpRequest request, WorkspaceRegistry registry, WorkflowRunners runners) =>
        {
            var body = await Reply.LenientBody(request);
            return await MutateAsync(registry.Get(repoId), runners, runner => runner.Message(runId, Str(body, "target") ?? "run", Str(body, "text") ?? ""));
        });

        app.MapPost("/repos/{repoId}/runs/{runId}/redo", async (string repoId, string runId, HttpRequest request, WorkspaceRegistry registry, WorkflowRunners runners) =>
        {
            var body = await Reply.LenientBody(request);
            if (Str(body, "from") is not { } from) return Reply.Error(400, "from is required");
            StepEdit? edit = null;
            if (body["stepEdit"] is JsonObject raw && Str(raw, "prompt") is { } prompt)
                edit = new StepEdit { Prompt = prompt, SaveToWorkflow = Json.Bool(raw["saveToWorkflow"]) };
            return await MutateAsync(registry.Get(repoId), runners, runner => runner.Redo(runId, from, Str(body, "note"), edit));
        });

        app.MapPost("/repos/{repoId}/runs/{runId}/redo/cancel", (string repoId, string runId, WorkspaceRegistry registry, WorkflowRunners runners) =>
            Mutate(registry.Get(repoId), runners, runner => runner.CancelRedo(runId)));

        app.MapPost("/mcp/runs/{repoId}/{runId}", async (string repoId, string runId, HttpRequest request, WorkspaceRegistry registry, WorkflowRunners runners) =>
        {
            var body = await Reply.LenientBody(request);
            return await Reply.GuardAsync(async () =>
            {
                var response = await runners.For(registry.Get(repoId)).HandleMcp(runId, request.Headers.Authorization.ToString(), body);
                return response is null ? Results.StatusCode(202) : Results.Text(response.ToJsonString(), "application/json; charset=utf-8");
            });
        });
    }

    /// <summary>The skills installed in the project (.claude/skills/*/SKILL.md), with the description from each front matter.</summary>
    private static List<object> ListSkills(string root)
    {
        var dir = Path.Combine(root, ".claude", "skills");
        var skills = new List<object>();
        if (!Directory.Exists(dir)) return skills;
        foreach (var folder in Directory.EnumerateDirectories(dir).OrderBy(p => p, StringComparer.Ordinal))
        {
            var file = Path.Combine(folder, "SKILL.md");
            var name = Path.GetFileName(folder);
            if (!File.Exists(file) || !RunStore.IsSafeId(name)) continue;
            var description = "";
            try
            {
                foreach (var line in File.ReadLines(file).Skip(1).TakeWhile(l => l.Trim() != "---"))
                    if (line.StartsWith("description:", StringComparison.Ordinal)) { description = line["description:".Length..].Trim().Trim('"', '\''); break; }
            }
            catch (IOException) { }
            skills.Add(new { name, description });
        }
        return skills;
    }

    /// <summary>Parses and validates a workflow definition body shared by create and update.</summary>
    private static async Task<(WorkflowDef? Def, string? Error)> ReadDefinition(HttpRequest request, SkillAgents agents, CliResolver resolver)
    {
        WorkflowDef? def;
        try { def = await JsonSerializer.DeserializeAsync<WorkflowDef>(request.Body, WorkflowJson.Options); }
        catch (JsonException) { return (null, "Invalid workflow JSON"); }
        var error = WorkflowValidation.Validate(def, AdapterOf(agents, resolver));
        return error is null ? (def, null) : (null, error);
    }

    /// <summary>A provider id's CLI adapter (null: the workflow-step call-site default), or null for an unknown or non-CLI provider; each id is looked up once per validation.</summary>
    private static Func<string?, string?> AdapterOf(SkillAgents agents, CliResolver resolver)
    {
        var spec = agents["workflow-step"].Spec;
        var cache = new Dictionary<string, string?>();
        return providerId =>
        {
            var key = providerId ?? "";
            if (!cache.TryGetValue(key, out var adapter)) cache[key] = adapter = resolver.AdapterOf(providerId, spec.Name, spec.Model);
            return adapter;
        };
    }

    private static string? Str(JsonObject body, string key) => Json.NonEmptyStr(body[key]);

    private static IResult Mutate<T>(Workspace ws, WorkflowRunners runners, Func<WorkflowRunner, T> action) where T : notnull =>
        ws.ReadOnly ? Reply.Error(409, "a pull-request workspace is read-only") : Reply.Guard(() => JsonResult(action(runners.For(ws))));

    private static async Task<IResult> MutateAsync<T>(Workspace ws, WorkflowRunners runners, Func<WorkflowRunner, Task<T>> action) where T : notnull
    {
        if (ws.ReadOnly) return Reply.Error(409, "a pull-request workspace is read-only");
        return await Reply.GuardAsync(async () => JsonResult(await action(runners.For(ws))));
    }
}
