using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Prs;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workflows;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Agents;

/// <summary>The hard limit of live agents is reached (409).</summary>
public sealed class AgentLimitException(string message) : BridgeException(409, message);

/// <summary>No agent with that id is registered (404).</summary>
public sealed class UnknownAgentException(string id) : BridgeException(404, id);

/// <summary>
/// The agent registry, worktree creation, and the 5-agent cap. agents.json lives in the main repository because it spans all
/// worktrees; an agent's own artifacts already sit in the .codechroma/ of its worktree. There is no base_commit field: the
/// divergence point is `git merge-base`, computed on demand.
/// </summary>
public sealed partial class AgentManager
{
    public const int MaxAgents = 5;
    private const int RegistryVersion = 1;

    private readonly object _lock = new();
    private readonly List<AgentRecord> _agents = [];
    private readonly List<string> _runCleanups = [];
    private string _activeWorkspace = Workspace.MainId;
    private string? _pendingActive;

    public AgentManager(string mainRoot)
    {
        MainRoot = Path.GetFullPath(mainRoot).TrimEnd('\\', '/');
        Load();
    }

    public string MainRoot { get; }

    /// <summary>Resolves a pr-N attach_to to the PR it names, so Create can fork from its head.</summary>
    public Func<string, PrRecord?> PrLookup { get; set; } = _ => null;

    /// <summary>"Can the canvas draw this id?" for ids this manager knows nothing about, for example a PR's.</summary>
    public Func<string, bool> WorkspaceGuard { get; set; } = _ => false;

    /// <summary>Resolves a br_* worktree tab, so Create can share its worktree and base branch.</summary>
    public Func<string, BranchRecord?> BranchLookup { get; set; } = _ => null;

    public string RegistryPath => Path.Combine(MainRoot, ".codechroma", "agents.json");

    public string ActiveWorkspace => _activeWorkspace;

    [GeneratedRegex(@"^pr-\d+$")]
    private static partial Regex PrWorkspaceId();

    private void Load()
    {
        lock (_lock)
        {
            var raw = JsonFile.LoadObject(RegistryPath);
            if (raw["agents"] is JsonArray entries)
                foreach (var entry in entries)
                    if (AgentRecord.FromJson(entry) is { } record) _agents.Add(record);
            var active = Json.Str(raw["active_workspace"]);
            if (string.IsNullOrEmpty(active)) return;
            if (active == Workspace.MainId || _agents.Any(a => a.Id == active)) _activeWorkspace = active;
            else _pendingActive = active;
        }
    }

    /// <summary>Atomic temp+rename: a half-written registry would lose every agent card.</summary>
    public void Save()
    {
        JsonObject payload;
        lock (_lock)
            payload = new JsonObject
            {
                ["version"] = RegistryVersion,
                ["agents"] = new JsonArray(_agents.Select(a => (JsonNode?)a.ToJson()).ToArray()),
                ["active_workspace"] = _activeWorkspace,
            };
        JsonFile.Write(RegistryPath, payload);
    }

    // --- reads ---

    /// <summary>Agents reviewing pr_id, so a PR close or refresh can refuse while one is attached.</summary>
    public List<AgentRecord> AttachedToPr(string prId)
    {
        lock (_lock) return _agents.Where(a => a.SourcePr == prId).ToList();
    }

    public List<AgentRecord> List()
    {
        lock (_lock)
        {
            foreach (var record in _agents) RefreshLiveBranch(record);
            return [.. _agents];
        }
    }

    public AgentRecord Get(string id)
    {
        lock (_lock)
        {
            var record = _agents.FirstOrDefault(a => a.Id == id) ?? throw new UnknownAgentException(id);
            RefreshLiveBranch(record);
            return record;
        }
    }

    /// <summary>An agent living in main's own tree tracks whatever branch main has checked out now.</summary>
    private void RefreshLiveBranch(AgentRecord record)
    {
        if (!SamePath(record.Worktree, MainRoot)) return;
        var live = MainBranchOps.CurrentBranch(MainRoot);
        if (live is null) return;
        record.Branch = live;
        record.BaseBranch = live;
    }

    // --- writes ---

    /// <summary>Slug, record, persist: the agent shares attach_to's worktree, or its tab's (workspace) when attach_to is absent; main is never a target.</summary>
    public AgentRecord Create(string title, string kind = AgentRecord.DefaultKind, string? attachTo = null, string? context = null, string contextKind = "view", string? diagramType = null, string? diagramRequest = null, string? workspace = null)
    {
        if (attachTo == Workspace.MainId) throw new WorktreeException("agents cannot attach to main");
        if (attachTo is null && string.IsNullOrEmpty(workspace)) throw new WorktreeException("workspace is required");
        if (!string.IsNullOrEmpty(workspace) && !workspace.StartsWith(BranchManager.IdPrefix, StringComparison.Ordinal))
            throw new WorktreeException($"workspace must be a worktree tab id, not '{workspace}'");
        if (!string.IsNullOrEmpty(workspace) && BranchLookup(workspace) is null) throw new UnknownAgentException(workspace);
        attachTo ??= workspace;
        context = AgentRecord.CleanContext(context);
        contextKind = AgentRecord.CoerceContextKind(contextKind);
        return Add(title, (agentId, displayTitle, createdAt) =>
        {
            var prTarget = PrTarget(attachTo!);
            string branch, path;
            string? baseBranch;
            if (prTarget is not null)
            {
                if (string.IsNullOrEmpty(prTarget.Worktree)) throw new WorktreeException($"PR {attachTo} has no worktree to attach to");
                branch = prTarget.HeadRef;
                path = prTarget.Worktree;
                baseBranch = prTarget.BaseRef;
            }
            else
            {
                (branch, path) = AttachTarget(attachTo!);
                baseBranch = BaseBranchFor(attachTo);
            }
            return new AgentRecord
            {
                Id = agentId,
                Title = displayTitle,
                Kind = kind,
                Branch = branch,
                Worktree = path,
                CreatedAt = createdAt,
                SharesWorkspaceWith = attachTo,
                Workspace = string.IsNullOrEmpty(workspace) ? null : workspace,
                BaseBranch = baseBranch,
                SourcePr = prTarget is not null ? attachTo : null,
                Context = context,
                ContextKind = contextKind,
                DiagramType = diagramType,
                DiagramRequest = diagramRequest,
            };
        });
    }

    /// <summary>A claude agent in a workflow run's own worktree that forks `forkSession` on start ("Open agent" on a finished step).</summary>
    public AgentRecord CreateInRun(string title, string runId, string forkSession)
    {
        if (!RunStore.IsSafeId(runId)) throw new WorktreeException($"invalid run id: {runId}");
        return Add(title, (agentId, displayTitle, createdAt) =>
        {
            var path = Path.GetFullPath(WorkflowRunner.WorktreeFor(MainRoot, runId));
            if (_runCleanups.Any(p => SamePath(p, path))) throw new BridgeException(409, "the run workspace is being cleaned up");
            if (!Directory.Exists(path)) throw new UnknownAgentException($"run {runId} has no worktree");
            return new AgentRecord
            {
                Id = agentId,
                Title = displayTitle,
                Kind = AgentRecord.DefaultKind,
                Branch = MainBranchOps.CurrentBranch(path) ?? $"wf-{runId}",
                Worktree = path,
                CreatedAt = createdAt,
                BaseBranch = MainBranchOps.CurrentBranch(MainRoot),
                SourceRun = runId,
                ForkSession = forkSession,
            };
        });
    }

    /// <summary>Reserves a workspace until cleanup finishes; attached agent windows must be closed first.</summary>
    public IDisposable ReserveRunCleanup(string worktree)
    {
        lock (_lock)
        {
            if (_agents.Any(a => SamePath(a.Worktree, worktree)))
                throw new BridgeException(409, "close the agents attached to this run before deleting or restarting it");
            if (_runCleanups.Any(p => SamePath(p, worktree)))
                throw new BridgeException(409, "the run workspace is being cleaned up");
            _runCleanups.Add(worktree);
        }
        return new CleanupReservation(() => { lock (_lock) _runCleanups.Remove(worktree); });
    }

    private sealed class CleanupReservation(Action release) : IDisposable
    {
        private Action? _release = release;
        public void Dispose() => Interlocked.Exchange(ref _release, null)?.Invoke();
    }

    /// <summary>Under the agent limit, builds a record for a fresh id (title falls back to it), stacks its window on top and persists.</summary>
    private AgentRecord Add(string title, Func<string, string, string, AgentRecord> build)
    {
        AgentRecord record;
        lock (_lock)
        {
            if (_agents.Count >= MaxAgents) throw new AgentLimitException($"the limit of {MaxAgents} concurrent agents is reached");
            var agentId = UniqueId(title);
            record = build(agentId, title.Trim().Length > 0 ? title.Trim() : agentId, DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture));
            record.Window["z"] = _agents.Count + 1;
            _agents.Add(record);
        }
        Save();
        return record;
    }

    private PrRecord? PrTarget(string attachTo)
    {
        if (!PrWorkspaceId().IsMatch(attachTo)) return null;
        return PrLookup(attachTo) ?? throw new UnknownAgentException(attachTo);
    }

    private string? BaseBranchFor(string? attachTo)
    {
        if (attachTo is null || attachTo == Workspace.MainId) return MainBranchOps.CurrentBranch(MainRoot);
        return BranchLookup(attachTo) is { } tab ? tab.Branch : Get(attachTo).BaseBranch;
    }

    /// <summary>The branch/worktree an attach-created agent shares: a worktree tab's, or another agent's.</summary>
    private (string Branch, string Path) AttachTarget(string attachTo)
    {
        if (BranchLookup(attachTo) is { } tab)
        {
            if (!Directory.Exists(tab.Worktree)) throw new WorktreeException($"the worktree of {attachTo} is missing; restore it first");
            return (tab.Branch, tab.Worktree);
        }
        var target = Get(attachTo);
        return (target.Branch, target.Worktree);
    }

    /// <summary>Agents living in a worktree tab: created in it, or sharing its worktree.</summary>
    public List<AgentRecord> AttachedToWorkspace(string workspaceId)
    {
        lock (_lock) return _agents.Where(a => InWorkspace(a, workspaceId)).ToList();
    }

    private static bool InWorkspace(AgentRecord a, string workspaceId) =>
        a.Workspace == workspaceId || a.SharesWorkspaceWith == workspaceId;

    /// <summary>Points every agent of a renamed tab at the tab's new git branch.</summary>
    public void RenameBranch(string workspaceId, string branch)
    {
        lock (_lock)
            foreach (var agent in _agents.Where(a => InWorkspace(a, workspaceId)))
            {
                agent.Branch = branch;
                agent.BaseBranch = branch;
            }
        Save();
    }

    private void InstallSkills(string root) => SkillSync.InstallIntoWorktree(root);

    private void SeedDiagrams(string root)
    {
        try { DiagramSeed.SeedFromMain(MainRoot, root); }
        catch (IOException) { /* a worktree that could not be seeded just opens undrawn */ }
    }

    /// <summary>Both flags default off: the work stays in the branch until the user says otherwise.</summary>
    public AgentRecord Delete(string agentId, bool removeWorktree = false, bool removeBranch = false, bool force = false)
    {
        AgentRecord record;
        lock (_lock)
        {
            record = Get(agentId);
            if (removeWorktree || removeBranch) GuardSharedWorktree(agentId, record);
            if (removeWorktree) WorktreeOps.Remove(MainRoot, record.Worktree, force);
            if (removeBranch) WorktreeOps.DeleteBranch(MainRoot, record.Branch);
            _agents.Remove(record);
            if (_activeWorkspace == agentId) _activeWorkspace = Workspace.MainId;
        }
        Save();
        return record;
    }

    /// <summary>Refuses to remove a worktree/branch shared with main, a PR, or another agent.</summary>
    private void GuardSharedWorktree(string agentId, AgentRecord record)
    {
        if (SamePath(record.Worktree, MainRoot)) throw new WorktreeException("cannot delete main's own worktree or branch through an agent");
        if (record.SourceRun is not null) throw new WorktreeException($"{record.Worktree} belongs to workflow run '{record.SourceRun}' -- delete the run instead");
        if (record.SharesWorkspaceWith is not null)
            throw new WorktreeException($"{record.Worktree} is shared with '{record.SharesWorkspaceWith}' -- cannot delete it through this agent");
        var sharing = _agents.FirstOrDefault(other => other.Id != agentId && other.Worktree == record.Worktree);
        if (sharing is not null) throw new WorktreeException($"{record.Worktree} is still in use by agent '{sharing.Id}'");
    }

    public AgentRecord MarkStarted(string agentId, int? pid, string resolvedCli = "")
    {
        var record = Get(agentId);
        record.Pid = pid;
        record.Status = AgentRecord.StatusRunning;
        record.ExitCode = null;
        if (resolvedCli.Length > 0) record.ResolvedCli = resolvedCli;
        Save();
        return record;
    }

    public AgentRecord MarkStopped(string agentId, int? exitCode = null)
    {
        var record = Get(agentId);
        record.Pid = null;
        record.Status = exitCode is not null ? AgentRecord.StatusExited : AgentRecord.StatusStopped;
        record.ExitCode = exitCode;
        Save();
        return record;
    }

    /// <summary>Checks the agent's branch out again after its directory was deleted by hand.</summary>
    public AgentRecord RecreateWorktree(string agentId)
    {
        var record = Get(agentId);
        var path = record.Worktree;
        if (Directory.Exists(path))
        {
            ClearWorktreeLost(path);
            return record;
        }
        WorktreeOps.Prune(MainRoot);
        WorktreeOps.Attach(MainRoot, record.Branch, path);
        InstallSkills(path);
        SeedDiagrams(path);
        ClearWorktreeLost(path);
        Save();
        return record;
    }

    private void ClearWorktreeLost(string path)
    {
        lock (_lock)
            foreach (var sibling in _agents.Where(a => SamePath(a.Worktree, path))) sibling.WorktreeLost = false;
    }

    /// <summary>Reads only the file wired to this agent's own process; never infers ownership from transcript recency.</summary>
    public string? CaptureSessionId(string agentId)
    {
        lock (_lock)
        {
            var record = Get(agentId);
            if (record.SessionTrackingId is { } trackingId)
            {
                var found = Json.Str(JsonFile.LoadObject(AgentSessionOwnership.FileFor(MainRoot, trackingId))["session_id"]);
                if (Guid.TryParse(found, out _) && found != record.SessionId)
                {
                    record.SessionId = found;
                    Save();
                }
            }
            return record.SessionId;
        }
    }

    /// <summary>Persists metadata from the actual PTY returned by Start, including an existing idempotent start.</summary>
    public void RecordSessionLaunch(string agentId, AgentSession session)
    {
        if (session.SessionTrackingFile is null) return;
        lock (_lock)
        {
            var record = Get(agentId);
            var trackingId = Path.GetFileNameWithoutExtension(session.SessionTrackingFile);
            if (record.SessionTrackingId == trackingId) return;
            record.SessionTrackingId = trackingId;
            record.SessionId = session.InitialSessionId;
            Save();
        }
    }

    /// <summary>Pending (context, kind), cleared so a resume or restart never re-injects it.</summary>
    public (string Text, string Kind)? ConsumeContext(string agentId)
    {
        var record = Get(agentId);
        if (record.Context is null) return null;
        var pending = (record.Context, record.ContextKind);
        record.Context = null;
        Save();
        return pending;
    }

    /// <summary>Merges a geometry patch onto the stored window, dropping keys and types it cannot use.</summary>
    public AgentRecord UpdateWindow(string agentId, JsonNode? window)
    {
        var record = Get(agentId);
        foreach (var (key, value) in SanitizeWindow(window)) record.Window[key] = value;
        Save();
        return record;
    }

    private static Dictionary<string, JsonNode?> SanitizeWindow(JsonNode? raw)
    {
        var clean = new Dictionary<string, JsonNode?>();
        if (raw is not JsonObject o) return clean;
        foreach (var key in new[] { "x", "y", "width", "height", "z" })
        {
            if (o[key] is not JsonValue value || !value.TryGetValue<double>(out var number)) continue;
            clean[key] = key is "x" or "y" ? JsonValue.Create(number) : JsonValue.Create((int)number);
        }
        if (o["minimized"] is JsonValue flag && flag.TryGetValue<bool>(out var minimized)) clean["minimized"] = JsonValue.Create(minimized);
        return clean;
    }

    // --- active workspace ---

    /// <summary>Records what the canvas is drawing: main, a known agent, or a registered workspace.</summary>
    public void SetActiveWorkspace(string workspaceId)
    {
        bool known;
        lock (_lock) known = workspaceId == Workspace.MainId || _agents.Any(a => a.Id == workspaceId);
        if (!known && !WorkspaceGuard(workspaceId)) throw new UnknownAgentException(workspaceId);
        _activeWorkspace = workspaceId;
        Save();
    }

    /// <summary>Promotes an active id deferred at load once every non-agent workspace is registered.</summary>
    public void RevalidateActiveWorkspace()
    {
        var pending = _pendingActive;
        _pendingActive = null;
        if (pending is null) return;
        if (WorkspaceGuard(pending)) _activeWorkspace = pending;
        else Save();
    }

    // --- startup reconciliation ---

    /// <summary>Renames shadowing ids, relocates legacy worktrees, prunes, then flags vanished ones.</summary>
    public void Reconcile()
    {
        RenameShadowingIds();
        MigrateWorktrees();
        WorktreeOps.Prune(MainRoot);
        foreach (var record in List())
        {
            // a surviving pid is an orphan and pids get recycled: clear it, never kill it
            record.Pid = null;
            record.Status = AgentRecord.StatusStopped;
            record.ExitCode = null;
            record.WorktreeLost = !Directory.Exists(record.Worktree);
            if (record.WorktreeLost) continue;
            InstallSkills(record.Worktree);
            SeedDiagrams(record.Worktree);
        }
    }

    /// <summary>Relocates every worktree still under the old ~/.codechroma/worktrees into the repo.</summary>
    public List<(string From, string To)> MigrateWorktrees()
    {
        var moved = new List<(string, string)>();
        if (!string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(WorktreeOps.WorkspacesDirEnv))) return moved;
        var legacyRoot = WorktreeOps.LegacyWorktreesRoot();
        var targetRoot = WorktreeOps.WorktreesRoot(MainRoot);
        foreach (var entry in WorktreeOps.ListWorktrees(MainRoot))
        {
            var source = entry.Path;
            if (!Directory.Exists(source) || !IsUnder(source, legacyRoot)) continue;
            var target = Path.Combine(targetRoot, Path.GetFileName(source.TrimEnd('\\', '/')));
            if (Directory.Exists(target) || File.Exists(target)) continue;
            try { WorktreeOps.Move(MainRoot, source, target); }
            catch (WorktreeException) { continue; }
            moved.Add((source, target));
            lock (_lock)
                foreach (var record in _agents.Where(a => SamePath(a.Worktree, source))) record.Worktree = target;
        }
        if (moved.Count > 0)
        {
            Save();
            try { Directory.Delete(Path.GetDirectoryName(moved[0].Item1)!); } catch (IOException) { }
        }
        return moved;
    }

    private void RenameShadowingIds()
    {
        List<AgentRecord> shadowing;
        lock (_lock) shadowing = _agents.Where(a => ShadowsAWorkspace(a.Id)).ToList();
        if (shadowing.Count == 0) return;
        foreach (var record in shadowing)
            lock (_lock)
            {
                _agents.Remove(record);
                record.Id = UniqueId(record.Title.Length > 0 ? record.Title : Workspace.MainId);
                _agents.Add(record);
            }
        Save();
    }

    private static bool ShadowsAWorkspace(string agentId) => agentId == Workspace.MainId || PrWorkspaceId().IsMatch(agentId);

    /// <summary>A slug nothing else is using: not this registry, a shadow, or a leftover worktree.</summary>
    private string UniqueId(string title)
    {
        WorktreeOps.Prune(MainRoot);
        var reserved = _agents.Select(a => a.Id).Concat(WorktreeIdsInUse()).ToHashSet();
        var baseId = BranchManager.Slugify(title, _agents.Count + 1);
        var candidate = baseId;
        for (var suffix = 2; reserved.Contains(candidate) || ShadowsAWorkspace(candidate); suffix++) candidate = $"{baseId}-{suffix}";
        return candidate;
    }

    /// <summary>Agent ids git still holds a worktree or branch for, including ones this registry lost.</summary>
    private HashSet<string> WorktreeIdsInUse()
    {
        var ids = WorktreeOps.ListWorktrees(MainRoot).Select(e => e.Branch).Where(b => b is not null && b.StartsWith(WorktreeOps.BranchPrefix, StringComparison.Ordinal))
            .Select(b => b![WorktreeOps.BranchPrefix.Length..]).ToHashSet();
        ids.UnionWith(WorktreeOps.ListAgentBranches(MainRoot).Select(b => b[WorktreeOps.BranchPrefix.Length..]));
        return ids;
    }

    private static bool IsUnder(string path, string root) =>
        Path.GetFullPath(path).Replace('\\', '/').StartsWith(Path.GetFullPath(root).Replace('\\', '/').TrimEnd('/') + "/",
            OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);

    private static bool SamePath(string a, string b) =>
        string.Equals(Path.GetFullPath(a).TrimEnd('\\', '/'), Path.GetFullPath(b).TrimEnd('\\', '/'),
            OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);
}
