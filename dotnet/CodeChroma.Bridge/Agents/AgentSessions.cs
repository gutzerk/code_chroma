using System.Text.Json.Nodes;
using System.Threading.Channels;
using CodeChroma.Bridge.Terminal;

namespace CodeChroma.Bridge.Agents;

/// <summary>One attached window's feed of terminal output; it completes when the process ends.</summary>
public sealed class AgentConsumer
{
    internal Channel<string> Channel { get; } = System.Threading.Channels.Channel.CreateUnbounded<string>(new UnboundedChannelOptions { SingleReader = true });

    public ChannelReader<string> Output => Channel.Reader;
}

/// <summary>A long-lived PTY session a terminal window can attach to and follow live.</summary>
public interface IAgentSessionPort
{
    AgentConsumer Attach();
    void Resync(AgentConsumer consumer);
    void Detach(AgentConsumer consumer);
    void Write(string data);
    void WriteBytes(byte[] data);
    void Resize(int rows, int cols);
}

/// <summary>
/// One PTY-attached agent process plus its screen and the windows watching it. The session outlives any single WebSocket:
/// minimizing a window or reloading the page must not kill the agent, so output fans out to zero or more consumers and a
/// reattaching one is sent a redraw of the current screen rather than a replay of raw bytes.
/// </summary>
public sealed class AgentSession : IAgentSessionPort, IDisposable
{
    private readonly object _gate = new();
    private readonly object _injectGate = new();
    private Task _injectChain = Task.CompletedTask;
    private readonly List<AgentConsumer> _consumers = [];
    private readonly ScreenTap _tap = new(PtyLaunch.DefaultRows, PtyLaunch.DefaultCols);
    private readonly StatusDetector _detector;
    private readonly PtyHost _pty;
    private readonly ForegroundProcess _foreground;
    private readonly AgentStatusState _state = new();
    private readonly Action<AgentSession>? _exited;
    private int? _exitCode;
    private bool _closing;
    private AgentError? _error;
    private (long Generation, string Title, string Progress, string? Process)? _screenKey;
    private DetectClassification _screenVerdict = DetectClassification.Hold;

    public AgentSession(string agentId, PtyLaunch launch, string kind = "claude", string? banner = null, Action<AgentSession>? onExit = null)
    {
        AgentId = agentId;
        _exited = onExit;
        Argv = [.. launch.Argv];
        SessionTrackingFile = launch.Env?.GetValueOrDefault(AgentSessionOwnership.FileEnv);
        InitialSessionId = launch.Env?.GetValueOrDefault(AgentSessionOwnership.InitialIdEnv);
        _detector = new StatusDetector(StatusRules.ForKind(kind));
        // callbacks take _gate, so none can observe _pty before it is assigned
        lock (_gate)
        {
            _pty = PtyHost.Start(launch, OnOutput, OnExit);
            if (banner is not null) _tap.Feed(banner);
        }
        _foreground = new ForegroundProcess(_pty.Pid);
    }

    public string AgentId { get; }

    public IReadOnlyList<string> Argv { get; }

    public string? SessionTrackingFile { get; }
    public string? InitialSessionId { get; }

    public int Pid => _pty.Pid;

    public int? ExitCode
    {
        get { lock (_gate) return _exitCode; }
    }

    public bool IsAlive => ExitCode is null;

    /// <summary>Whether the detector can ever report idle, so an InjectWhenIdle can ever type.</summary>
    public bool DetectsIdle => _detector.Rules.Classifies;

    public ScreenTap Screen => _tap;

    /// <summary>While it runs: idle, working, blocked or done; once gone: error after a non-zero exit, else stopped.</summary>
    public string Status => Snapshot().Status;

    /// <summary>The live status fields; an exited session reports stopped, or error with its exit error, since its exit.</summary>
    public AgentStatusSnapshot Snapshot()
    {
        var live = _state.Snapshot();
        lock (_gate)
        {
            if (_exitCode is null) return live;
            return _error is null
                ? new AgentStatusSnapshot(AgentStatus.Stopped, live.Since, null, null)
                : new AgentStatusSnapshot(AgentStatus.Error, live.Since, null, null, _error);
        }
    }

    /// <summary>Samples the screen once; true when the status payload changed (hooks, once reporting, own working and idle).</summary>
    public bool PollStatus()
    {
        if (!IsAlive) return false;
        var key = (Generation: _tap.Generation, Title: _tap.Title, Progress: _tap.Progress, Process: _foreground.Current());
        // the rules only run when the screen, title, progress or process changed; the hysteresis still runs every poll
        if (_screenKey != key)
        {
            _screenVerdict = _detector.Evaluate(_tap.Tail(_detector.Rules.TailLines), key.Title, key.Progress, key.Process);
            _screenKey = key;
        }
        var verdict = _detector.Settle(_screenVerdict);
        var changed = _state.ApplyScreen(verdict, _detector.LastVisibleBlocker);
        Sync();
        return changed;
    }

    /// <summary>Applies one Claude Code hook report and keeps the detector in step with it.</summary>
    public HookOutcome ApplyHook(JsonObject body)
    {
        if (!IsAlive) return new HookOutcome(false);
        var outcome = _state.ApplyHook(body);
        Sync();
        return outcome;
    }

    /// <summary>Once hooks report, the detector holds whatever status they set.</summary>
    private void Sync()
    {
        if (_state.Hooked) _detector.Force(_state.Live);
    }

    /// <summary>Done becomes idle; true when that changed the status.</summary>
    public bool MarkSeen() => _state.MarkSeen();

    /// <summary>Answers a pending PermissionRequest; false when no such request waits.</summary>
    public bool Decide(string requestId, string decision) => _state.Decide(requestId, decision);

    /// <summary>Drops an unanswered PermissionRequest; true when it was still pending.</summary>
    public bool ExpirePermission(string requestId) => _state.Expire(requestId);

    /// <summary>Clears the exit error so the agent reads as stopped; true when there was one.</summary>
    public bool DismissError()
    {
        lock (_gate)
        {
            if (_error is null) return false;
            _error = null;
            return true;
        }
    }

    /// <summary>A consumer seeded with a screen redraw, so a reattach can never start mid-sequence; the history waits for Resync unless the process has exited.</summary>
    public AgentConsumer Attach()
    {
        var consumer = new AgentConsumer();
        lock (_gate)
        {
            consumer.Channel.Writer.TryWrite(_tap.Render(withHistory: _exitCode is not null));
            if (_exitCode is not null) consumer.Channel.Writer.TryComplete();
            else _consumers.Add(consumer);
        }
        return consumer;
    }

    /// <summary>Redraws one consumer with the full history, so a client that just reported its own size sees that geometry.</summary>
    public void Resync(AgentConsumer consumer)
    {
        lock (_gate)
            if (_consumers.Contains(consumer)) consumer.Channel.Writer.TryWrite(_tap.Render());
    }

    /// <summary>Drops one consumer; the process keeps running with nobody watching.</summary>
    public void Detach(AgentConsumer consumer)
    {
        lock (_gate) _consumers.Remove(consumer);
    }

    public void Write(string data) => _pty.Write(data);

    public void WriteBytes(byte[] data) => _pty.WriteBytes(data);

    public void Resize(int rows, int cols)
    {
        _pty.Resize(rows, cols);
        _tap.Resize(rows, cols);
    }

    /// <summary>
    /// Types `text` once a fresh agent's TUI reaches its idle prompt (acknowledge-only context). Polls the same detector rules the
    /// LED uses; gives up quietly if the agent never idles in time or dies, because typing into a working or blocked agent would
    /// corrupt whatever it is already doing. The task resolves true once the text was typed.
    /// </summary>
    public Task<bool> InjectWhenIdle(string text, int attempts = 60, TimeSpan? interval = null) => InjectWhenIdle(() => text, attempts, interval);

    /// <summary>Like the string overload, but builds the text at idle time; a null text means nothing is left to type.</summary>
    public Task<bool> InjectWhenIdle(Func<string?> text, int attempts = 60, TimeSpan? interval = null)
    {
        var wait = interval ?? TimeSpan.FromMilliseconds(500);
        lock (_injectGate)
        {
            var typed = _injectChain.ContinueWith(_ => InjectOnce(text, attempts, wait), TaskScheduler.Default).Unwrap();
            _injectChain = typed;
            return typed;
        }
    }

    /// <summary>The pause between the typed text and Enter; one write of both reads as a paste, whose Enter only adds a newline.</summary>
    public static readonly TimeSpan SubmitDelay = TimeSpan.FromMilliseconds(300);

    /// <summary>Types `text`, waits `delay`, then presses Enter as its own write, so the TUI submits it instead of pasting.</summary>
    public static async Task TypeAndSubmit(Action<string> write, string text, TimeSpan delay)
    {
        write(text);
        await Task.Delay(delay);
        write("\r");
    }

    /// <summary>One queued injection: waits for idle, types it, then lets the screen settle so the next one sees the agent busy; true when typed.</summary>
    private async Task<bool> InjectOnce(Func<string?> text, int attempts, TimeSpan wait)
    {
        for (var attempt = 0; attempt < attempts; attempt++)
        {
            if (ExitCode is not null) return false;
            var verdict = _detector.Classify(_tap.Tail(_detector.Rules.TailLines), _tap.Title, _tap.Progress, null);
            if (verdict == AgentStatus.Idle)
            {
                if (BuildText(text) is not { } body) return false;
                await TypeAndSubmit(Write, body, SubmitDelay);
                await Task.Delay(wait);
                return true;
            }
            await Task.Delay(wait);
        }
        return false;
    }

    /// <summary>The text to type now; a builder that throws counts as nothing to type.</summary>
    private string? BuildText(Func<string?> text)
    {
        try { return text(); }
        catch (Exception error)
        {
            Console.Error.WriteLine($"agents: could not build the text to type into {AgentId}: {error.Message}");
            return null;
        }
    }

    /// <summary>Kills the process; the exit callback then completes every consumer, and the deliberate kill is no error.</summary>
    public void Close()
    {
        lock (_gate) _closing = true;
        _pty.Close();
    }

    public void Dispose() => _pty.Dispose();

    private void OnOutput(string chunk)
    {
        _tap.Feed(chunk);
        AgentConsumer[] targets;
        lock (_gate) targets = [.. _consumers];
        foreach (var consumer in targets) consumer.Channel.Writer.TryWrite(chunk);
    }

    private void OnExit()
    {
        AgentConsumer[] targets;
        lock (_gate)
        {
            _exitCode = _pty?.ExitCode ?? 0;
            if (_exitCode != 0 && !_closing)
                _error = new AgentError($"{Path.GetFileNameWithoutExtension(Argv.FirstOrDefault() ?? "agent")} exited with code {_exitCode}", DateTimeOffset.UtcNow);
            targets = [.. _consumers];
            _consumers.Clear();
        }
        _state.Exit();
        foreach (var consumer in targets) consumer.Channel.Writer.TryComplete();
        try { _exited?.Invoke(this); }
        catch (Exception error) { Console.Error.WriteLine($"agents: exit callback failed for {AgentId}: {error.Message}"); }
    }
}

/// <summary>Every live agent PTY, keyed by agent id: the one place their processes are tracked.</summary>
public sealed class AgentSessionRegistry(Skills.RuntimeEnvironment runtime) : IDisposable
{
    private readonly Dictionary<string, AgentSession> _sessions = [];
    private readonly object _lock = new();

    public AgentSession? Get(string agentId)
    {
        lock (_lock) return _sessions.GetValueOrDefault(agentId);
    }

    /// <summary>Called with the agent id when a registered session's process exits on its own (not after Stop).</summary>
    public Action<string>? Exited { get; set; }

    /// <summary>Every agent whose status payload just changed.</summary>
    public List<string> PollStatuses()
    {
        List<KeyValuePair<string, AgentSession>> snapshot;
        lock (_lock) snapshot = [.. _sessions];
        return snapshot.Where(kv => kv.Value.PollStatus()).Select(kv => kv.Key).ToList();
    }

    /// <summary>Spawns the agent, or returns the session already running for it.</summary>
    public AgentSession Start(string agentId, IReadOnlyList<string> argv, string cwd, string kind = "claude", IReadOnlyDictionary<string, string>? env = null, Stores.UserPaths? paths = null, string? banner = null)
    {
        var spawnEnv = runtime.TerminalEnv(env);
        lock (_lock)
        {
            if (_sessions.TryGetValue(agentId, out var existing) && existing.IsAlive) return existing;
            if (argv.Count == 0) throw new AgentStartException("no command configured for this agent kind");
            string executable;
            try { executable = CliResolver.Resolve(argv[0], paths); }
            catch (CliLookupException error) { throw new AgentStartException(error.Message); }
            if (!Directory.Exists(cwd)) throw new AgentStartException($"the agent's worktree is missing: {cwd}");
            try
            {
                var session = new AgentSession(agentId, new PtyLaunch([executable, .. argv.Skip(1)], cwd, spawnEnv), kind, banner, OnSessionExit);
                _sessions[agentId] = session;
                return session;
            }
            catch (Exception error) when (error is not OutOfMemoryException)
            {
                throw new AgentStartException($"Resolved CLI '{executable}', but process launch failed: {error.Message}");
            }
        }
    }

    private void OnSessionExit(AgentSession session)
    {
        bool current;
        lock (_lock) current = _sessions.GetValueOrDefault(session.AgentId) == session;
        if (current) Exited?.Invoke(session.AgentId);
    }

    /// <summary>Kills one agent's PTY, keeping its worktree and branch; false if it was not running.</summary>
    public bool Stop(string agentId)
    {
        AgentSession? session;
        lock (_lock)
        {
            if (!_sessions.Remove(agentId, out session)) return false;
        }
        session.Close();
        session.Dispose();
        return true;
    }

    public void StopAll()
    {
        string[] ids;
        lock (_lock) ids = [.. _sessions.Keys];
        foreach (var id in ids) Stop(id);
    }

    public void Dispose() => StopAll();
}
