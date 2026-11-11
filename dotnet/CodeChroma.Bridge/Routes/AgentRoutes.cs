using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http.Features;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Context;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Live;
using CodeChroma.Bridge.Prs;
using CodeChroma.Bridge.Questions;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Terminal;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>Parallel agents: the cards, their worktrees, their PTYs, and publishing one as a PR (routes/agents.py).</summary>
public static class AgentRoutes
{
    /// <summary>How long a PermissionRequest hook call waits for a canvas decision before the terminal dialog takes over.</summary>
    public const int PermissionWaitMs = AgentHook.PermissionWaitMs;

    /// <summary>The largest hook report the bridge reads; the hook already slims its payload far below this.</summary>
    public const int HookBodyLimit = 256 * 1024;

    // one status read-and-send at a time, so a stale snapshot is never broadcast after a newer one
    private static readonly object StatusGate = new();

    /// <summary>How a launch's view context starts, so auto-title can tell it from the user's own words.</summary>
    public const string ContextPrefix = "[Context]";

    /// <summary>The hidden context a canvas launch adds to the user's first prompt.</summary>
    public static string ViewContext(string view) =>
        $"This agent was launched from the CodeChroma canvas while the user was looking at: {view}. Use it as background for the user's message.";

    /// <summary>The launch context typed as its own turn for a CLI without the hidden first-prompt hook.</summary>
    public static string TypedViewContext(string view) =>
        $"{ContextPrefix} You were just launched from the CodeChroma canvas. The user is currently looking at: {view}. "
        + "Please acknowledge you understand this context. Do not act on it or start any work — just confirm you've read it and say you're ready.";

    public static void Map(WebApplication app, string repoRoot)
    {
        app.MapGet("/agents/git-preflight", () => Reply.GuardBlocking(() => Reply.Json(AgentBootstrap.Preflight(repoRoot))));

        app.MapPost("/agents/git-init", (HttpRequest request) => Reply.GuardAsync(async () =>
        {
            var body = await Reply.LenientBody(request);
            var extra = body["extra_ignores"] is JsonArray list ? list.Select(Json.Str).OfType<string>().ToList() : [];
            return Reply.Json(await Task.Run(() => AgentBootstrap.Initialize(repoRoot, extra)));
        }));

        app.MapGet("/agents", (AgentManager agents, AgentSessionRegistry sessions, WorkspaceRegistry registry) => Reply.GuardBlocking(() => Reply.Json(new JsonObject
        {
            ["agents"] = new JsonArray(agents.List().Select(r => (JsonNode?)WithOpenQuestions(Payload(sessions, r), registry, r.Id)).ToArray()),
            ["active_workspace"] = agents.ActiveWorkspace,
            ["max_agents"] = AgentManager.MaxAgents,
        })));

        app.MapPost("/agents", (HttpRequest request, AgentManager agents, AgentSessionRegistry sessions, WorkspaceRegistry registry, ConnectionManager connections, WorkflowRunners runners) => Reply.GuardAsync(async () =>
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
                try { forked = await Task.Run(() => agents.CreateInRun(title, runId, forkSession, runners.RootOfRun(runId))); }
                catch (UnknownAgentException error) { return Reply.Error(404, error.Message); }
                catch (WorktreeException error) { return Reply.Error(400, error.Message); }
                registry.Register(forked.Id, forked.Worktree);
                await Task.Run(() => ForgetLeftoverQuestions(registry, forked.Id));
                var forkedPayload = forked.ToPayload();
                await connections.Broadcast(new JsonObject { ["type"] = "agent-added", ["agent"] = forkedPayload.DeepClone() });
                return Reply.Json(forkedPayload);
            }
            var hint = DiagramHint.Parse(body);
            if (hint.Error is not null) return Reply.Error(400, hint.Error);
            if (hint.WorkflowRequest is not null && (contextKind != "task" || AgentRecord.CleanContext(context) is null))
                return Reply.Error(400, "workflow_request needs context_kind 'task' and a context");
            var drawing = contextKind == "task" && hint.Type is not null;
            AgentRecord record;
            try { record = await Task.Run(() => agents.Create(title, kind, attachTo, context, contextKind, drawing ? hint.Type : null, drawing ? hint.Request : null, workspace, hint.WorkflowRequest)); }
            catch (UnknownAgentException) { return Reply.Error(404, attachTo is null ? $"unknown workspace: {workspace}" : $"unknown attach_to: {attachTo}"); }
            catch (WorktreeException error) { return Reply.Error(400, error.Message); }
            registry.Register(record.Id, record.Worktree, sharesWorkspaceWith: record.SharesWorkspaceWith);
            await Task.Run(() => ForgetLeftoverQuestions(registry, record.Id));
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
            DrawDelegation? delegation = null;
            var delegates = record.DiagramType is not null && BareSkill.Enabled() && terminalAgents.Delegates(record.Kind);
            if ((taskText is not null || (sessionId is not null && delegates)) && record.DiagramType is { } diagramType)
            {
                var workspaceId = record.SharesWorkspaceWith ?? record.Id;
                var target = TryWorkspace(registry, workspaceId);
                var command = target is null ? null : await diagramContext.CommandAsync(target);
                (taskText, banner, bare, visible, delegation) = DrawStart.Plan(diagramType, record.DiagramRequest, taskText, sessionId is not null, delegates,
                    terminalAgents.SplitsSystemPrompt(record.Kind), target?.Root ?? record.Worktree, workspaceId, command);
            }
            else if (taskText is not null && record.WorkflowRequest is { } workflowRequest)
            {
                var workspaceId = record.SharesWorkspaceWith ?? record.Id;
                // without the skill the agent would get neither the workflow shape nor the user's description
                if (BareSkill.ComposeWorkflow(TryWorkspace(registry, workspaceId)?.Root ?? record.Worktree, workflowRequest) is not { } composed)
                    return Reply.Error(503, $"the {BareSkill.WorkflowSkill} skill is not installed");
                taskText = composed;
                bare = BareSkill.Enabled();
                visible = bare ? workflowRequest : null;
            }
            var trackingFile = AgentSessionOwnership.FileFor(agents.MainRoot, Guid.NewGuid().ToString());
            var launch = terminalAgents.Resolve(record.Kind, sessionId, taskText, bare, visible, forkSession: fork, agentId: agentId, bridgeUrl: BareSkill.BridgeUrl,
                newSessionId: Guid.NewGuid().ToString(), sessionTrackingFile: trackingFile, workdir: record.Worktree, delegation: delegation);
            if (launch is null) return Reply.Error(400, $"unknown agent kind: {record.Kind}");
            var env = new Dictionary<string, string>(launch.Env);
            BridgeAddress.ExportIdentity(env, agentId, BareSkill.BridgeUrl);
            AgentSession session;
            try { session = await Task.Run(() => sessions.Start(agentId, launch.Argv, record.Worktree, launch.DetectorKind ?? record.Kind, env, paths, banner, launch.Clear)); }
            catch (AgentStartException error)
            {
                record.StartError = new AgentError(error.Message, DateTimeOffset.UtcNow);
                await BroadcastStatus(connections, sessions, record);
                throw;
            }
            record.StartError = null;
            session.Delegation = delegation;
            var updated = agents.MarkStarted(agentId, session.Pid, TerminalAgents.ResolvedCliFor(record.Kind, launch.Argv));
            // a view context rides hidden with the user's first prompt (UserPromptSubmit hook); a CLI without that hook gets it typed once idle
            if (pending is { Kind: not "task" } view && launch.PromptContext == PromptContext.Hidden) session.HoldPromptContext(ViewContext(view.Text));
            else if (pending is { Kind: not "task" } typed && launch.PromptContext == PromptContext.Typed) _ = session.InjectWhenIdle(TypedViewContext(typed.Text));
            agents.RecordSessionLaunch(agentId, session);
            var payload = Payload(sessions, updated);
            await BroadcastStatus(connections, sessions, updated);
            return Reply.Json(payload);
        }));

        app.MapPost("/agents/{agentId}/hook", (string agentId, HttpRequest request, QuestionMcp mcp, AgentManager agents, AgentSessionRegistry sessions, ConnectionManager connections) => Reply.GuardAsync(async () =>
        {
            if (!mcp.Authorizes(request.Headers.Authorization.ToString(), agentId)) return Reply.Error(401, "invalid or missing workspace token");
            if (request.ContentLength > HookBodyLimit) return Reply.Error(413, "hook report too large");
            if (request.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } cap) cap.MaxRequestBodySize = HookBodyLimit;
            var record = OrNotFound(agents, agentId);
            var body = await Reply.LenientBody(request);
            var session = sessions.Get(agentId);
            if (session is null) return Reply.Json(new JsonObject { ["ok"] = true });
            var outcome = session.ApplyHook(body);
            var context = AgentHook.IsPromptSubmit(body) ? session.TakePromptContext() : null;
            if (outcome.Changed) await BroadcastStatus(connections, sessions, record);
            if (AutoTitle.Triggers(body)) ScheduleAutoTitle(agents, connections, record, transcriptPath: Json.Str(body["transcript_path"]));
            if (outcome.Decision is not { } waiting)
            {
                var reply = new JsonObject { ["ok"] = true };
                if (context is not null) reply["additional_context"] = context;
                return Reply.Json(reply);
            }
            var decision = await WaitForDecision(waiting, request.HttpContext.RequestAborted);
            if (decision is null)
            {
                if (session.ExpirePermission(outcome.RequestId!)) await BroadcastStatus(connections, sessions, record);
                // a decision that landed between the timeout and the expiry still reaches the hook
                else if (waiting.IsCompletedSuccessfully) decision = waiting.Result;
            }
            return Reply.Json(new JsonObject { ["decision"] = decision });
        }));

        app.MapPost("/agents/{agentId}/seen", (string agentId, AgentManager agents, AgentSessionRegistry sessions, ConnectionManager connections) => Reply.GuardAsync(async () =>
        {
            var record = OrNotFound(agents, agentId);
            if (sessions.Get(agentId)?.MarkSeen() == true) await BroadcastStatus(connections, sessions, record);
            return Reply.Json(Payload(sessions, record));
        }));

        app.MapPost("/agents/{agentId}/dismiss-error", (string agentId, AgentManager agents, AgentSessionRegistry sessions, ConnectionManager connections) => Reply.GuardAsync(async () =>
        {
            var record = OrNotFound(agents, agentId);
            if (DismissError(sessions, record)) await BroadcastStatus(connections, sessions, record);
            return Reply.Json(Payload(sessions, record));
        }));

        app.MapPost("/agents/{agentId}/permission", (string agentId, HttpRequest request, AgentManager agents, AgentSessionRegistry sessions, ConnectionManager connections) => Reply.GuardAsync(async () =>
        {
            var record = OrNotFound(agents, agentId);
            var body = await Reply.LenientBody(request);
            var decision = Json.Str(body["decision"]);
            if (decision is not ("allow" or "deny")) return Reply.Error(400, "decision must be 'allow' or 'deny'");
            var requestId = Json.Str(body["request_id"]) ?? "";
            if (sessions.Get(agentId)?.Decide(requestId, decision!) != true) return Reply.Error(404, $"no pending permission request: {requestId}");
            await BroadcastStatus(connections, sessions, record);
            return Reply.Json(Payload(sessions, record));
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
            var stopped = agents.MarkStopped(agentId);
            var payload = Payload(sessions, stopped);
            await BroadcastStatus(connections, sessions, stopped);
            return Reply.Json(payload);
        }));

        app.MapGet("/agents/{agentId}/usage", (string agentId, AgentManager agents) => Reply.GuardBlocking(() =>
        {
            var record = OrNotFound(agents, agentId);
            return Reply.Json(AgentUsage.Read(record, () => agents.CaptureSessionId(agentId)));
        }));

        app.MapGet("/agents/{agentId}/prompts", (string agentId, AgentManager agents) => Reply.GuardBlocking(() =>
        {
            var record = OrNotFound(agents, agentId);
            return Reply.Json(AgentPrompts.Read(record, () => agents.CaptureSessionId(agentId)));
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

        app.MapPatch("/agents/{agentId}", (string agentId, HttpRequest request, AgentManager agents, AgentSessionRegistry sessions, ConnectionManager connections) => Reply.GuardAsync(async () =>
        {
            var body = await Reply.LenientBody(request);
            if (Json.Str(body["title"]) is not { } title) return Reply.Error(400, "title must be a string");
            if (title.Trim().Length > AutoTitle.MaxUserChars) return Reply.Error(400, $"title must be at most {AutoTitle.MaxUserChars} characters");
            OrNotFound(agents, agentId);
            var record = agents.Rename(agentId, title);
            await BroadcastTitle(connections, record);
            return Reply.Json(Payload(sessions, record));
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
        record.Pid = session?.Pid;
        record.ExitCode = session?.ExitCode;
        var status = StatusJson(session, record);
        var payload = record.ToPayload();
        foreach (var (field, value) in status) payload[field] = value?.DeepClone();
        return payload;
    }

    /// <summary>The list row also carries how many ask_user questions the agent has open; `agent-questions` events keep it current.</summary>
    private static JsonObject WithOpenQuestions(JsonObject payload, WorkspaceRegistry registry, string agentId)
    {
        try { payload["open_questions"] = AgentQuestionView.OpenCount(registry, agentId); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Text.Json.JsonException) { payload["open_questions"] = 0; }
        return payload;
    }

    /// <summary>The five status fields: a failed start wins, else the live session, else stopped since it was last seen running.</summary>
    public static JsonObject StatusJson(AgentSession? session, AgentRecord record)
    {
        lock (StatusGate) return StatusJsonLocked(session, record);
    }

    private static JsonObject StatusJsonLocked(AgentSession? session, AgentRecord record)
    {
        var live = record.StartError is { } failed
            ? new AgentStatusSnapshot(AgentStatus.Error, failed.At, null, null, failed)
            : session?.Snapshot();
        if (live is null)
        {
            if (record.Status != AgentStatus.Stopped || record.StatusSince is null) record.StatusSince = DateTimeOffset.UtcNow;
            live = new AgentStatusSnapshot(AgentStatus.Stopped, record.StatusSince.Value, null, null);
        }
        record.Status = live.Status;
        record.StatusSince = live.Since;
        return new JsonObject
        {
            ["status"] = live.Status,
            ["status_since"] = Json.Iso(live.Since),
            ["activity"] = live.Status == AgentStatus.Working ? live.Activity?.ToJson() : null,
            ["pending_permission"] = live.Pending?.ToJson(),
            ["error"] = live.Error?.ToJson(),
        };
    }

    /// <summary>The LED's only input: one agent-status event per real change, over the existing socket.</summary>
    public static Task BroadcastStatus(ConnectionManager connections, AgentSessionRegistry sessions, AgentRecord record)
    {
        lock (StatusGate)
        {
            var message = new JsonObject { ["type"] = "agent-status", ["id"] = record.Id };
            foreach (var (field, value) in StatusJsonLocked(sessions.Get(record.Id), record)) message[field] = value?.DeepClone();
            return connections.Broadcast(message);
        }
    }

    /// <summary>Agents whose auto-title refresh is running: whether another report asked for one meanwhile, and its transcript path.</summary>
    private static readonly Dictionary<string, (bool Again, string? TranscriptPath)> TitleRefreshes = new();

    /// <summary>Re-derives the agent's title from its session off the request path and pushes it when it changed; a hand-set title is left alone. A report during a refresh runs one more after it, so a turn's Stop is never lost.</summary>
    public static void ScheduleAutoTitle(AgentManager agents, ConnectionManager connections, AgentRecord record, string? projectsRoot = null, string? transcriptPath = null)
    {
        if (record.TitleSource == AutoTitle.UserSource || !record.HasClaudeSession) return;
        lock (TitleRefreshes)
        {
            if (TitleRefreshes.TryGetValue(record.Id, out var running))
            {
                TitleRefreshes[record.Id] = (true, transcriptPath ?? running.TranscriptPath);
                return;
            }
            TitleRefreshes[record.Id] = (false, transcriptPath);
        }
        _ = Task.Run(async () =>
        {
            var path = transcriptPath;
            var finished = false;
            try
            {
                while (!finished)
                {
                    try
                    {
                        if (AutoTitle.Suggest(record, () => agents.CaptureSessionId(record.Id), projectsRoot, path) is { } title && agents.ApplyAutoTitle(record.Id, title) is { } renamed)
                            await BroadcastTitle(connections, renamed);
                    }
                    catch (Exception error) when (error is UnknownAgentException or IOException or UnauthorizedAccessException) { }
                    lock (TitleRefreshes)
                    {
                        var state = TitleRefreshes[record.Id];
                        if (state.Again) (TitleRefreshes[record.Id], path) = ((false, state.TranscriptPath), state.TranscriptPath);
                        else finished = TitleRefreshes.Remove(record.Id);
                    }
                }
            }
            finally
            {
                if (!finished) lock (TitleRefreshes) TitleRefreshes.Remove(record.Id);
            }
        });
    }

    /// <summary>The `agent-title` push: the new title and who set it.</summary>
    public static Task BroadcastTitle(ConnectionManager connections, AgentRecord record) =>
        connections.Broadcast(new JsonObject { ["type"] = AutoTitle.TitleEvent, ["id"] = record.Id, ["title"] = record.Title, ["title_source"] = record.TitleSource });

    /// <summary>Clears a failed start and a session's exit error, so the agent reads as stopped; true when either was set.</summary>
    private static bool DismissError(AgentSessionRegistry sessions, AgentRecord record)
    {
        var hadStartError = record.StartError is not null;
        record.StartError = null;
        return (sessions.Get(record.Id)?.DismissError() ?? false) | hadStartError;
    }

    /// <summary>The canvas's decision, or null once the wait times out or the hook hangs up.</summary>
    private static async Task<string?> WaitForDecision(Task<string?> waiting, CancellationToken aborted)
    {
        try { return await waiting.WaitAsync(TimeSpan.FromMilliseconds(PermissionWaitMs), aborted); }
        catch (Exception error) when (error is TimeoutException or OperationCanceledException) { return null; }
    }

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

    /// <summary>A new agent may reuse a closed agent's id: drops that agent's leftover questions so the new window never shows them; never fails the create.</summary>
    private static void ForgetLeftoverQuestions(WorkspaceRegistry registry, string agentId)
    {
        try
        {
            if (AgentQuestionView.HasAny(registry, agentId)) QuestionStore.ForgetAgent(registry.Get(agentId), agentId);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"questions: could not clear the leftover questions of agent {agentId}: {error.Message}");
        }
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
