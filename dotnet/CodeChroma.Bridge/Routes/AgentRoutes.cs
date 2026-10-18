using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Live;
using CodeChroma.Bridge.Prs;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Terminal;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>Parallel agents: the cards, their worktrees, their PTYs, and publishing one as a PR (routes/agents.py).</summary>
public static class AgentRoutes
{
    private const int SessionIdPollAttempts = 10;
    private static readonly TimeSpan SessionIdPollInterval = TimeSpan.FromSeconds(1);

    public static void Map(WebApplication app, string repoRoot)
    {
        app.MapGet("/agents/git-preflight", () => Reply.GuardBlocking(() => Reply.Json(AgentBootstrap.Preflight(repoRoot))));

        app.MapPost("/agents/git-init", (HttpRequest request) => Reply.GuardAsync(async () =>
        {
            var body = await Reply.LenientBody(request);
            var extra = body["extra_ignores"] is JsonArray list ? list.Select(Json.Str).OfType<string>().ToList() : [];
            return Reply.Json(await Task.Run(() => AgentBootstrap.Initialize(repoRoot, extra)));
        }));

        app.MapGet("/agents/branch", () => Reply.GuardBlocking(() => Reply.Json(new JsonObject
        {
            ["current"] = MainBranchOps.CurrentBranch(repoRoot),
            ["branches"] = Strings(MainBranchOps.SwitchableBranches(repoRoot)),
        })));

        app.MapPost("/agents/branch", (HttpRequest request, AgentManager agents, AgentSessionRegistry sessions, ConnectionManager connections) => Reply.GuardAsync(async () =>
        {
            var body = await Reply.LenientBody(request);
            if (Json.Str(body["branch"]) is not { Length: > 0 } branch) return Reply.Error(400, "branch is required");
            RefuseIfLiveAgentInMain(agents, sessions, repoRoot);
            try { await Task.Run(() => MainBranchOps.Checkout(repoRoot, branch)); }
            catch (UnknownBranchException) { return Reply.Error(404, $"unknown branch: {branch}"); }
            await connections.Broadcast(new JsonObject { ["type"] = "branch-changed", ["branch"] = branch });
            return Reply.Json(new JsonObject { ["current"] = branch, ["branches"] = Strings(await Task.Run(() => MainBranchOps.SwitchableBranches(repoRoot))) });
        }));

        app.MapPost("/agents/branch/update", (AgentManager agents, AgentSessionRegistry sessions, ConnectionManager connections) => Reply.GuardAsync(async () =>
        {
            RefuseIfLiveAgentInMain(agents, sessions, repoRoot);
            var branch = await Task.Run(() => MainBranchOps.UpdateBranch(repoRoot));
            await connections.Broadcast(new JsonObject { ["type"] = "branch-changed" });
            return Reply.Json(new JsonObject { ["current"] = branch, ["branches"] = Strings(await Task.Run(() => MainBranchOps.SwitchableBranches(repoRoot))) });
        }));

        app.MapGet("/agents", (AgentManager agents, AgentSessionRegistry sessions) => Reply.Guard(() => Reply.Json(new JsonObject
        {
            ["agents"] = new JsonArray(agents.List().Select(r => (JsonNode?)Payload(sessions, r)).ToArray()),
            ["active_workspace"] = agents.ActiveWorkspace,
            ["max_agents"] = AgentManager.MaxAgents,
        })));

        app.MapPost("/agents", (HttpRequest request, AgentManager agents, AgentSessionRegistry sessions, WorkspaceRegistry registry, ConnectionManager connections) => Reply.GuardAsync(async () =>
        {
            var body = await Reply.LenientBody(request);
            var invalid = Validate(body, out var title, out var kind, out var attachTo, out var context, out var contextKind);
            if (invalid is not null) return Reply.Error(400, invalid);
            AgentRecord record;
            try { record = await Task.Run(() => agents.Create(title, kind, attachTo, context, contextKind)); }
            catch (UnknownAgentException) { return Reply.Error(404, $"unknown attach_to: {attachTo}"); }
            catch (WorktreeException error) { return Reply.Error(400, error.Message); }
            registry.Register(record.Id, record.Worktree, sharesWorkspaceWith: record.SharesWorkspaceWith);
            var payload = record.ToPayload();
            await connections.Broadcast(new JsonObject { ["type"] = "agent-added", ["agent"] = payload.DeepClone() });
            return Reply.Json(payload);
        }));

        app.MapPost("/agents/{agentId}/start", (string agentId, HttpRequest request, AgentManager agents, AgentSessionRegistry sessions, TerminalAgents terminalAgents, UserPaths paths, ConnectionManager connections) => Reply.GuardAsync(async () =>
        {
            var body = await Reply.LenientBody(request);
            var record = OrNotFound(agents, agentId);
            var resume = body["resume"] is JsonValue flag && flag.TryGetValue<bool>(out var resumed) && resumed;
            var sessionId = resume ? agents.CaptureSessionId(agentId) : null;
            if (resume && string.IsNullOrEmpty(sessionId)) return Reply.Error(409, "this agent has no recorded session to resume");
            var pending = resume ? null : agents.ConsumeContext(agentId);
            var taskText = pending is { Kind: "task" } ? pending.Value.Text : null;
            var launch = terminalAgents.Resolve(record.Kind, sessionId, taskText);
            if (launch is null) return Reply.Error(400, $"unknown agent kind: {record.Kind}");
            var env = new Dictionary<string, string>(launch.Env) { ["codechroma_WORKSPACE_ID"] = agentId };
            var session = await Task.Run(() => sessions.Start(agentId, launch.Argv, record.Worktree, record.Kind, env, paths));
            var updated = agents.MarkStarted(agentId, session.Pid, TerminalAgents.ResolvedCliFor(record.Kind, launch.Argv));
            if (pending is { Kind: not "task" } view)
                _ = session.InjectWhenIdle(
                    $"[Context] You were just launched from the CodeChroma canvas. The user is currently looking at: {view.Text}. "
                    + "Please acknowledge you understand this context. Do not act on it or start any work — just confirm you've read it and say you're ready.");
            _ = CaptureSessionIdLater(agents, agentId);
            var payload = Payload(sessions, updated);
            await BroadcastStatus(connections, agentId, (string)payload["status"]!);
            return Reply.Json(payload);
        }));

        app.MapPost("/agents/{agentId}/recreate-worktree", (string agentId, AgentManager agents, AgentSessionRegistry sessions, WorkspaceRegistry registry) => Reply.GuardAsync(async () =>
        {
            try
            {
                var record = await Task.Run(() => agents.RecreateWorktree(agentId));
                registry.Register(record.Id, record.Worktree);
                return Reply.Json(Payload(sessions, record));
            }
            catch (UnknownAgentException) { return Reply.Error(404, $"unknown agent: {agentId}"); }
        }));

        app.MapPost("/agents/{agentId}/stop", (string agentId, AgentManager agents, AgentSessionRegistry sessions, ConnectionManager connections) => Reply.GuardAsync(async () =>
        {
            OrNotFound(agents, agentId);
            sessions.Stop(agentId);
            var payload = Payload(sessions, agents.MarkStopped(agentId));
            await BroadcastStatus(connections, agentId, (string)payload["status"]!);
            return Reply.Json(payload);
        }));

        app.MapGet("/agents/{agentId}/pr-preflight", (string agentId, AgentManager agents) => Reply.GuardBlocking(() =>
        {
            var record = OrNotFound(agents, agentId);
            return Reply.Json(Publish.Preflight(record.Worktree, record.Branch, WorktreeOps.MainBranch(repoRoot), record.SourcePr));
        }));

        app.MapPost("/agents/{agentId}/pr", (string agentId, HttpRequest request, AgentManager agents, AgentSessionRegistry sessions, UserPaths paths) => Reply.GuardAsync(async () =>
        {
            var record = OrNotFound(agents, agentId);
            var body = await Reply.LenientBody(request);
            var main = await Task.Run(() => WorktreeOps.MainBranch(repoRoot));
            var commitDirty = body["commit_dirty"] is JsonValue flag && flag.TryGetValue<bool>(out var dirty) && dirty;
            var url = await Task.Run(() => Publish.CreatePr(record.Worktree, record.Branch, main, commitDirty, record.SourcePr, paths));
            record.PrUrl = url;
            agents.Save();
            var payload = Payload(sessions, record);
            payload["pr_url"] = url;
            return Reply.Json(payload);
        }));

        app.MapDelete("/agents/{agentId}", (string agentId, HttpRequest request, AgentManager agents, AgentSessionRegistry sessions, WorkspaceRegistry registry, ConnectionManager connections) => Reply.GuardAsync(async () =>
        {
            try
            {
                var record = await Task.Run(() => agents.Delete(agentId, Flag(request, "worktree"), Flag(request, "branch"), Flag(request, "force")));
                sessions.Stop(agentId);
                await Task.Run(() => registry.Unregister(agentId));
                await connections.Broadcast(new JsonObject { ["type"] = "agent-removed", ["id"] = agentId });
                return Reply.Json(new JsonObject { ["status"] = "deleted", ["id"] = record.Id });
            }
            catch (UnknownAgentException) { return Reply.Error(404, $"unknown agent: {agentId}"); }
        }));

        app.MapPatch("/agents/{agentId}/window", (string agentId, HttpRequest request, AgentManager agents) => Reply.GuardAsync(async () =>
        {
            try { return Reply.Json(agents.UpdateWindow(agentId, await Reply.LenientBody(request)).Window); }
            catch (UnknownAgentException) { return Reply.Error(404, $"unknown agent: {agentId}"); }
        }));
    }

    /// <summary>The card with its status read from the live session registry, not from a stored field.</summary>
    public static JsonObject Payload(AgentSessionRegistry sessions, AgentRecord record)
    {
        var session = sessions.Get(record.Id);
        if (session is null)
        {
            record.Pid = null;
            record.Status = AgentRecord.StatusStopped;
            record.ExitCode = null;
        }
        else
        {
            record.Pid = session.Pid;
            record.Status = session.Status;
            record.ExitCode = session.ExitCode;
        }
        return record.ToPayload();
    }

    /// <summary>The LED's only input: one agent-status ping per real change, over the existing socket.</summary>
    public static Task BroadcastStatus(ConnectionManager connections, string agentId, string status) =>
        connections.Broadcast(new JsonObject { ["type"] = "agent-status", ["id"] = agentId, ["status"] = status });

    /// <summary>Polls briefly for the transcript: it does not exist the instant the process spawns.</summary>
    public static async Task CaptureSessionIdLater(AgentManager agents, string agentId)
    {
        for (var attempt = 0; attempt < SessionIdPollAttempts; attempt++)
        {
            await Task.Delay(SessionIdPollInterval);
            try { if (agents.CaptureSessionId(agentId) is not null) return; }
            catch (UnknownAgentException) { return; }
        }
    }

    private static string? Validate(JsonObject body, out string title, out string kind, out string? attachTo, out string? context, out string contextKind)
    {
        title = "";
        kind = AgentRecord.DefaultKind;
        attachTo = null;
        context = null;
        contextKind = "view";
        if (body["title"] is { } rawTitle)
        {
            if (Json.Str(rawTitle) is not { } t) return "title must be a string";
            title = t;
        }
        if (Json.Str(body["kind"]) is { } k) kind = k;
        if (!TerminalAgents.Allowed.ContainsKey(kind)) return $"unknown agent kind: {kind}";
        if (body["attach_to"] is { } rawAttach)
        {
            if (Json.Str(rawAttach) is not { } a) return "attach_to must be a string";
            attachTo = a;
        }
        if (body["context"] is { } rawContext)
        {
            if (Json.Str(rawContext) is not { } c) return "context must be a string";
            context = c;
        }
        if (body.ContainsKey("context_kind"))
        {
            if (Json.Str(body["context_kind"]) is not { } ck || !AgentRecord.ContextKinds.Contains(ck)) return "context_kind must be 'view' or 'task'";
            contextKind = ck;
        }
        return null;
    }

    /// <summary>A checkout or pull swaps files under a live agent parked in main's own tree, so refuse first.</summary>
    private static void RefuseIfLiveAgentInMain(AgentManager agents, AgentSessionRegistry sessions, string repoRoot)
    {
        var main = Path.GetFullPath(repoRoot).TrimEnd('\\', '/');
        foreach (var record in agents.List())
        {
            if (sessions.Get(record.Id) is not { IsAlive: true }) continue;
            var same = string.Equals(Path.GetFullPath(record.Worktree).TrimEnd('\\', '/'), main, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);
            if (same) throw new BridgeException(409, $"stop {record.Title} first — it works directly in the main worktree");
        }
    }

    private static AgentRecord OrNotFound(AgentManager agents, string agentId)
    {
        try { return agents.Get(agentId); }
        catch (UnknownAgentException) { throw new BridgeException(404, $"unknown agent: {agentId}"); }
    }

    private static bool Flag(HttpRequest request, string name) =>
        request.Query[name].ToString().ToLowerInvariant() is "true" or "1" or "yes" or "on" or "t" or "y";

    private static JsonArray Strings(IEnumerable<string> values) => new(values.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());

}
