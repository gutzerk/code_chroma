using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Live;
using CodeChroma.Bridge.Prs;
using CodeChroma.Bridge.Routes;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Terminal;
using CodeChroma.Bridge.Workspaces;
using Microsoft.AspNetCore.Hosting.Server;

namespace CodeChroma.Bridge.Agents;

/// <summary>DI registration for the agents, PR reviews and the PTY terminal host: one line in Program.cs.</summary>
public static class AgentsAndPrsServices
{
    public static IServiceCollection AddAgentsAndPrs(this IServiceCollection services, string repoRoot)
    {
        services.AddSingleton(_ => new AgentManager(repoRoot));
        services.AddSingleton(_ => new PrManager(repoRoot));
        services.AddSingleton<AgentSessionRegistry>();
        services.AddSingleton<TerminalAgents>();
        services.AddHostedService<AgentRuntime>();
        return services;
    }
}

/// <summary>
/// Boot and shutdown of everything agent-shaped: reconciles the registries, registers agent and PR workspaces, brings every
/// persisted agent's PTY back up, samples their screens for the status LED, and kills the PTYs on exit so no orphan keeps
/// writing to files behind the user's back.
/// </summary>
public sealed class AgentRuntime(
    AgentManager agents, PrManager prs, BranchManager branches, WorkspaceRegistry registry, AgentSessionRegistry sessions,
    TerminalAgents terminalAgents, ConnectionManager connections, UserPaths paths, ILogger<AgentRuntime> log, IServer server) : IHostedLifecycleService
{
    public const int StatusPollMs = 250;

    private CancellationTokenSource? _stop;
    private Task? _poller;

    public Task StartAsync(CancellationToken cancellationToken)
    {
        agents.Reconcile();
        foreach (var record in agents.List())
            registry.Register(record.Id, record.Worktree, sharesWorkspaceWith: record.SharesWorkspaceWith);

        prs.Reconcile();
        agents.PrLookup = prs.FindById;
        foreach (var pr in prs.List())
            registry.Register(pr.Id, pr.Worktree, readOnly: true, baseRef: PrImporter.LocalBaseRef(pr.Number), c1SourceRoot: registry.Main.Root);

        branches.ExtraHolders = () => [.. agents.List().Select(a => (a.Worktree, a.Id))];
        agents.WorkspaceGuard = registry.IsRegistered;
        agents.BranchLookup = branches.Find;
        agents.RevalidateActiveWorkspace();
        sessions.Exited = id => _ = BroadcastAgent(id);

        return Task.CompletedTask;
    }

    // All hosted services, including the HTTP server, have started before this hook runs.
    public Task StartedAsync(CancellationToken cancellationToken)
    {
        BareSkill.BridgeUrl = BridgeAddress.Local(server);
        AutoStartAgents();
        _stop = new CancellationTokenSource();
        _poller = Task.Run(() => PollStatuses(_stop.Token));
        return Task.CompletedTask;
    }

    public Task StartingAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    public Task StoppingAsync(CancellationToken cancellationToken) => Task.CompletedTask;
    public Task StoppedAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        _stop?.Cancel();
        if (_poller is not null) await Task.WhenAny(_poller, Task.Delay(TimeSpan.FromSeconds(2), cancellationToken));
        sessions.StopAll();
        foreach (var record in agents.List())
        {
            record.Pid = null;
            record.Status = AgentRecord.StatusStopped;
            record.ExitCode = null;
        }
        agents.Save();
    }

    /// <summary>One agent's failure to start is logged and skipped, never raised past this loop.</summary>
    private void AutoStartAgents()
    {
        foreach (var record in agents.List())
        {
            if (record.WorktreeLost || sessions.Get(record.Id) is not null) continue;
            try { AutoStartOne(record); }
            catch (Exception error)
            {
                log.LogError(error, "agents: auto-start failed for {Agent}", record.Id);
                Fail(record, error.Message);
            }
        }
    }

    /// <summary>Resumes the last chat when a session id survived, starts fresh otherwise.</summary>
    private void AutoStartOne(AgentRecord record)
    {
        var sessionId = agents.CaptureSessionId(record.Id);
        var fork = string.IsNullOrEmpty(sessionId) && record.ForkSession is { Length: > 0 };
        var launch = terminalAgents.Resolve(record.Kind, fork ? record.ForkSession : sessionId, forkSession: fork, agentId: record.Id, bridgeUrl: BareSkill.BridgeUrl,
            newSessionId: Guid.NewGuid().ToString(),
            sessionTrackingFile: AgentSessionOwnership.FileFor(agents.MainRoot, Guid.NewGuid().ToString()), workdir: record.Worktree);
        if (launch is null)
        {
            log.LogError("agents: unknown kind {Kind} for {Agent}, skipping auto-start", record.Kind, record.Id);
            Fail(record, $"unknown agent kind: {record.Kind}");
            return;
        }
        var env = new Dictionary<string, string>(launch.Env);
        BridgeAddress.ExportIdentity(env, record.Id, BareSkill.BridgeUrl);
        AgentSession session;
        try { session = sessions.Start(record.Id, launch.Argv, record.Worktree, launch.DetectorKind ?? record.Kind, env, paths); }
        catch (AgentStartException error)
        {
            log.LogWarning("agents: could not auto-start {Agent}: {Reason}", record.Id, error.Message);
            Fail(record, error.Message);
            return;
        }
        record.Error = null;
        agents.MarkStarted(record.Id, session.Pid, TerminalAgents.ResolvedCliFor(record.Kind, launch.Argv));
        agents.RecordSessionLaunch(record.Id, session);
    }

    /// <summary>Marks a failed auto-start as the agent's error and tells any open canvas.</summary>
    private void Fail(AgentRecord record, string message)
    {
        record.Error = new AgentError(message, DateTimeOffset.UtcNow);
        _ = BroadcastAgent(record.Id);
    }

    /// <summary>Pushes one agent's status fields; an agent deleted meanwhile is skipped.</summary>
    public async Task BroadcastAgent(string agentId)
    {
        try { await AgentRoutes.BroadcastStatus(connections, sessions, agents.Get(agentId)); }
        catch (UnknownAgentException) { }
        catch (Exception error) { log.LogError(error, "agents: status broadcast failed for {Agent}", agentId); }
    }

    /// <summary>Samples every live agent's screen and pushes only the changes the detector settled on.</summary>
    private async Task PollStatuses(CancellationToken stopping)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(StatusPollMs));
        try
        {
            while (await timer.WaitForNextTickAsync(stopping))
            {
                try
                {
                    foreach (var id in sessions.PollStatuses()) await BroadcastAgent(id);
                }
                catch (Exception error) when (error is not OperationCanceledException)
                {
                    log.LogError(error, "agents: status poll failed");
                }
            }
        }
        catch (OperationCanceledException) { }
    }
}
