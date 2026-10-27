using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Context;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Live;
using CodeChroma.Bridge.Prs;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Terminal;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>Parallel agents: the cards, their worktrees, their PTYs, and publishing one as a PR (routes/agents.py).</summary>
public static class AgentRoutes
{
    public static void Map(WebApplication app, string repoRoot)
    {
        app.MapGet("/agents/git-preflight", () => Reply.GuardBlocking(() => Reply.Json(AgentBootstrap.Preflight(repoRoot))));

        app.MapPost("/agents/git-init", (HttpRequest request) => Reply.GuardAsync(async () =>
        {
            var body = await Reply.LenientBody(request);
            var extra = body["extra_ignores"] is JsonArray list ? list.Select(Json.Str).OfType<string>().ToList() : [];
            return Reply.Json(await Task.Run(() => AgentBootstrap.Initialize(repoRoot, extra)));
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
            var invalid = Validate(body, out var title, out var kind, out var attachTo, out var context, out var contextKind, out var workspace);
            if (invalid is not null) return Reply.Error(400, invalid);
            if (body.ContainsKey("run_id") || body.ContainsKey("fork_session"))
            {
                if (Json.Str(body["run_id"]) is not { Length: > 0 } runId || Json.Str(body["fork_session"]) is not { Length: > 0 } forkSession)
                    return Reply.Error(400, "run_id and fork_session must both be given");
                if (kind != AgentRecord.DefaultKind) return Reply.Error(400, "fork_session needs kind 'claude'");
                AgentRecord forked;
                try { forked = await Task.Run(() => agents.CreateInRun(title, runId, forkSession)); }
                catch (UnknownAgentException error) { return Reply.Error(404, error.Message); }
                catch (WorktreeException error) { return Reply.Error(400, error.Message); }
                registry.Register(forked.Id, forked.Worktree);
                var forkedPayload = forked.ToPayload();
                await connections.Broadcast(new JsonObject { ["type"] = "agent-added", ["agent"] = forkedPayload.DeepClone() });
                return Reply.Json(forkedPayload);
            }
            var hint = DiagramHint.Parse(body);
            if (hint.Error is not null) return Reply.Error(400, hint.Error);
            var drawing = contextKind == "task" && hint.Type is not null;
            AgentRecord record;
            try { record = await Task.Run(() => agents.Create(title, kind, attachTo, context, contextKind, drawing ? hint.Type : null, drawing ? hint.Request : null, workspace)); }
            catch (UnknownAgentException) { return Reply.Error(404, attachTo is null ? $"unknown workspace: {workspace}" : $"unknown attach_to: {attachTo}"); }
            catch (WorktreeException error) { return Reply.Error(400, error.Message); }
            registry.Register(record.Id, record.Worktree, sharesWorkspaceWith: record.SharesWorkspaceWith);
            var payload = record.ToPayload();
            await connections.Broadcast(new JsonObject { ["type"] = "agent-added", ["agent"] = payload.DeepClone() });
            return Reply.Json(payload);
        }));

        app.MapPost("/agents/{agentId}/start", (string agentId, HttpRequest request, AgentManager agents, AgentSessionRegistry sessions, TerminalAgents terminalAgents, UserPaths paths, ConnectionManager connections, WorkspaceRegistry registry, DiagramContext diagramContext) => Reply.GuardAsync(async () =>
        {
            var body = await Reply.LenientBody(request);
            var record = OrNotFound(agents, agentId);
            var resume = Json.Bool(body["resume"]);
            var sessionId = resume ? agents.CaptureSessionId(agentId) : null;
            if (resume && string.IsNullOrEmpty(sessionId)) return Reply.Error(409, "this agent has no recorded session to resume");
            var fork = !resume && record.ForkSession is { Length: > 0 };
            if (fork) sessionId = record.ForkSession;
            var pending = resume ? null : agents.ConsumeContext(agentId);
            var taskText = pending is { Kind: "task" } ? pending.Value.Text : null;
            var bare = false;
            string? visible = null;
            string? banner = null;
            if (taskText is not null && record.DiagramType is { } diagramType)
            {
                var workspaceId = record.SharesWorkspaceWith ?? record.Id;
                var target = TryWorkspace(registry, workspaceId);
                var command = target is null ? null : await diagramContext.CommandAsync(target);
                // A resumed or forked session gets no bare --system-prompt, so the skill rides as the prompt and nothing waits on the question.
                var requested = !string.IsNullOrWhiteSpace(record.DiagramRequest);
                var asksInTerminal = !requested && sessionId is null && diagramType == DiagramContext.AnyType && BareSkill.Enabled() && terminalAgents.SplitsSystemPrompt(record.Kind);
                if (BareSkill.ComposeInteractive(diagramType, target?.Root ?? record.Worktree, workspaceId, command, asksInTerminal, record.DiagramRequest) is { } composed)
                {
                    taskText = composed;
                    bare = BareSkill.Enabled();
                    visible = bare ? (requested ? record.DiagramRequest : asksInTerminal ? "" : BareSkill.InteractiveVisiblePrompt) : null;
                    banner = asksInTerminal ? BareSkill.InteractiveQuestion : null;
                }
            }
            var trackingFile = AgentSessionOwnership.FileFor(agents.MainRoot, Guid.NewGuid().ToString());
            var launch = terminalAgents.Resolve(record.Kind, sessionId, taskText, bare, visible, forkSession: fork, agentId: agentId, bridgeUrl: BareSkill.BridgeUrl,
                newSessionId: Guid.NewGuid().ToString(), sessionTrackingFile: trackingFile);
            if (launch is null) return Reply.Error(400, $"unknown agent kind: {record.Kind}");
            var env = new Dictionary<string, string>(launch.Env);
            BridgeAddress.ExportIdentity(env, agentId, BareSkill.BridgeUrl);
            var session = await Task.Run(() => sessions.Start(agentId, launch.Argv, record.Worktree, record.Kind, env, paths, banner));
            var updated = agents.MarkStarted(agentId, session.Pid, TerminalAgents.ResolvedCliFor(record.Kind, launch.Argv));
            if (pending is { Kind: not "task" } view)
                _ = session.InjectWhenIdle(
                    $"[Context] You were just launched from the CodeChroma canvas. The user is currently looking at: {view.Text}. "
                    + "Please acknowledge you understand this context. Do not act on it or start any work — just confirm you've read it and say you're ready.");
            agents.RecordSessionLaunch(agentId, session);
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

        app.MapGet("/agents/{agentId}/usage", (string agentId, AgentManager agents) => Reply.GuardBlocking(() =>
        {
            var record = OrNotFound(agents, agentId);
            var sessionId = record.Kind == AgentRecord.DefaultKind ? agents.CaptureSessionId(agentId) : null;
            return Reply.Json(AgentUsage.Read(record, sessionId));
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
            var commitDirty = Json.Bool(body["commit_dirty"]);
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

    private static string? Validate(JsonObject body, out string title, out string kind, out string? attachTo, out string? context, out string contextKind, out string? workspace)
    {
        title = "";
        workspace = null;
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
        if (body["workspace"] is { } rawWorkspace)
        {
            if (Json.Str(rawWorkspace) is not { } w) return "workspace must be a string";
            workspace = w.Length > 0 ? w : null;
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

    private static Workspace? TryWorkspace(WorkspaceRegistry registry, string id)
    {
        try { return registry.Get(id); }
        catch (BridgeException) { return null; }
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
