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
    // the poll thread and hook requests both drive the detector, which is not thread-safe
    private readonly object _detectorGate = new();
    private readonly object _injectGate = new();
    private Task _injectChain = Task.CompletedTask;
    private readonly List<AgentConsumer> _consumers = [];
    private readonly ScreenTap _tap = new(PtyLaunch.DefaultRows, PtyLaunch.DefaultCols);
    private readonly StatusDetector _detector;
    private PtyHost _pty;
    private ForegroundProcess _foreground;
    // which PTY of this session is current; callbacks of a replaced one are ignored
    private long _spawn;
    private int _cols = PtyLaunch.DefaultCols;
    private int _narrowestPrinted = int.MaxValue;
    private DateTimeOffset _resizedAt = DateTimeOffset.MinValue;
    private DateTimeOffset _typedAt = DateTimeOffset.MinValue;
    private DateTimeOffset _widenNotBefore = DateTimeOffset.MinValue;
    private bool _draft;
    private int _injecting;
    private readonly AgentStatusState _state = new();
    private readonly Action<AgentSession>? _exited;
    private int? _exitCode;
    private bool _closing;
    private AgentError? _error;
    private (long Generation, string Title, string Progress, string? Process)? _screenKey;
    private DetectClassification _screenVerdict = DetectClassification.Hold;
    private readonly ClearWatch? _clear;
    private readonly TypedClearDetector? _typedClear;
    private readonly object _typedGate = new();
    private readonly Action<AgentSession>? _cleared;

    /// <summary>Erases xterm's scrollback (and the tap's history) but not the visible screen.</summary>
    public const string ClearScrollback = "\u001b[3J";

    public AgentSession(string agentId, PtyLaunch launch, string kind = "claude", string? banner = null, Action<AgentSession>? onExit = null, ClearWatch? clear = null, Action<AgentSession>? onClear = null)
    {
        AgentId = agentId;
        _exited = onExit;
        _clear = clear;
        _cleared = onClear;
        if (clear is { TypedCommands.Count: > 0 }) _typedClear = new TypedClearDetector(clear.TypedCommands);
        Argv = [.. launch.Argv];
        SessionTrackingFile = launch.Env?.GetValueOrDefault(AgentSessionOwnership.FileEnv);
        InitialSessionId = launch.Env?.GetValueOrDefault(AgentSessionOwnership.InitialIdEnv);
        _detector = new StatusDetector(StatusRules.ForKind(kind));
        // callbacks take _gate, so none can observe _pty before it is assigned
        lock (_gate)
        {
            _cols = launch.Cols;
            _pty = PtyHost.Start(launch, chunk => OnOutput(0, chunk), () => OnExit(0));
            if (banner is not null) _tap.Feed(banner);
        }
        _foreground = new ForegroundProcess(_pty.Pid);
    }

    public string AgentId { get; }

    public IReadOnlyList<string> Argv { get; private set; }

    public string? SessionTrackingFile { get; private set; }
    public string? InitialSessionId { get; private set; }

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
        lock (_detectorGate)
        {
            // the rules only run when the screen, title, progress or process changed; the hysteresis still runs every poll
            if (_screenKey != key)
            {
                _screenVerdict = _detector.Evaluate(_tap.Tail(_detector.Rules.TailLines), key.Title, key.Progress, key.Process);
                _screenKey = key;
            }
            var verdict = _detector.Settle(_screenVerdict);
            var last = _detector.LastClassification;
            var changed = _state.ApplyScreen(verdict, last.VisibleBlocker, last.VisibleIdle);
            Sync();
            return changed;
        }
    }

    /// <summary>Applies one Claude Code hook report and keeps the detector in step with it.</summary>
    public HookOutcome ApplyHook(JsonObject body)
    {
        if (!IsAlive) return new HookOutcome(false);
        if (AgentHook.IsClear(body)) ClearHistory();
        lock (_detectorGate)
        {
            var outcome = _state.ApplyHook(body);
            Sync();
            return outcome;
        }
    }

    /// <summary>Once hooks report, the detector holds whatever status they set.</summary>
    private void Sync()
    {
        if (_state.Hooked) _detector.Force(_state.Live);
    }

    /// <summary>Done becomes idle; true when that changed the status.</summary>
    public bool MarkSeen() => _state.MarkSeen();

    /// <summary>Answers a pending PermissionRequest; false when no such request waits.</summary>
    public bool Decide(string requestId, string decision)
    {
        lock (_detectorGate)
        {
            var decided = _state.Decide(requestId, decision);
            Sync();
            return decided;
        }
    }

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

    /// <summary>Types into the agent; a submitted clear command of a CLI without a clear hook also clears the window's history.</summary>
    public void Write(string data)
    {
        NoteTyping(data);
        _pty.Write(data);
        if (_typedClear is null) return;
        bool cleared;
        lock (_typedGate) cleared = _typedClear.Feed(data);
        if (cleared) ClearHistory();
    }

    /// <summary>The user cleared the conversation: the tap and every window drop their scrollback (sent down the output path, in order with the CLI's output), then the CLI repaints.</summary>
    public void ClearHistory()
    {
        if (!IsAlive) return;
        lock (_gate) OnOutput(_spawn, ClearScrollback);
        if (_clear?.Repaint is { } repaint) _ = RepaintLater(repaint);
        try { _cleared?.Invoke(this); }
        catch (Exception error) { Console.Error.WriteLine($"agents: clear callback failed for {AgentId}: {error.Message}"); }
    }

    /// <summary>How long the CLI gets to finish its own clear before the repaint key, so the repaint draws the fresh conversation.</summary>
    public static readonly TimeSpan RepaintDelay = TimeSpan.FromMilliseconds(300);

    private async Task RepaintLater(string repaint)
    {
        await Task.Delay(RepaintDelay);
        if (IsAlive) _pty.Write(repaint);
    }

    public void WriteBytes(byte[] data) => _pty.WriteBytes(data);

    public void Resize(int rows, int cols)
    {
        lock (_gate)
        {
            _pty.Resize(rows, cols);
            _tap.Resize(rows, cols);
            _cols = cols;
            _resizedAt = DateTimeOffset.UtcNow;
        }
    }

    /// <summary>Erases the screen and the scrollback, so a resumed process reprints the conversation into an empty terminal.</summary>
    public const string ResetScreen = "\u001b[0m\u001b[H\u001b[2J\u001b[3J";

    /// <summary>Whether a claude launch that can be resumed in place: tracked by CodeChroma and not a bare skill window.</summary>
    public bool ResumesOnWiden => SessionTrackingFile is not null && !Argv.Contains("--system-prompt");

    /// <summary>True once the window settled WidenResume.MinGainCols wider than the narrowest width this process printed at, while it is idle with nothing typed or queued.</summary>
    public bool WidenDue(DateTimeOffset now)
    {
        if (!ResumesOnWiden || Volatile.Read(ref _injecting) > 0) return false;
        var live = _state.Snapshot();
        if (live.Status is not (AgentStatus.Idle or AgentStatus.Done) || live.Pending is not null) return false;
        lock (_gate)
            return _exitCode is null && !_draft && _narrowestPrinted != int.MaxValue && _cols >= _narrowestPrinted + WidenResume.MinGainCols
                && now - _resizedAt >= WidenResume.Settle && now - _typedAt >= WidenResume.TypingQuiet && now >= _widenNotBefore;
    }

    /// <summary>Takes the current width as printed, so a widen that cannot be resumed is not retried.</summary>
    public void SettleWidth()
    {
        lock (_gate) _narrowestPrinted = _cols;
    }

    /// <summary>Holds a due widen until `until`, for a check that may pass later (an open question).</summary>
    public void PostponeWiden(DateTimeOffset until)
    {
        lock (_gate) _widenNotBefore = until;
    }

    /// <summary>Starts `argv` on a new PTY at the current size in place of the running one, keeping status and windows; false (old process untouched) when it cannot start.</summary>
    public bool Respawn(IReadOnlyList<string> argv, string? cwd, IReadOnlyDictionary<string, string>? env)
    {
        PtyHost old;
        lock (_gate)
        {
            if (_exitCode is not null || _closing) return false;
            var next = _spawn + 1;
            PtyHost fresh;
            try { fresh = PtyHost.Start(new PtyLaunch(argv, cwd, env, _tap.Rows, _cols), chunk => OnOutput(next, chunk), () => OnExit(next)); }
            catch (Exception error) when (error is not OutOfMemoryException)
            {
                Console.Error.WriteLine($"agents: could not restart {AgentId} at the new width: {error.Message}");
                return false;
            }
            old = _pty;
            _pty = fresh;
            _spawn = next;
            _foreground = new ForegroundProcess(fresh.Pid);
            Argv = [.. argv];
            SessionTrackingFile = env?.GetValueOrDefault(AgentSessionOwnership.FileEnv);
            InitialSessionId = env?.GetValueOrDefault(AgentSessionOwnership.InitialIdEnv);
            _narrowestPrinted = int.MaxValue;
            _draft = false;
            // the clear goes out before any byte of the new process, which waits on _gate
            _tap.Feed(ResetScreen);
            foreach (var consumer in _consumers) consumer.Channel.Writer.TryWrite(ResetScreen);
        }
        // reaping waits for the old child, so it runs off the caller's thread
        _ = Task.Run(old.Dispose);
        return true;
    }

    /// <summary>Tracks typed input: text without Enter is a draft a restart would lose; escape sequences (keys, focus, mouse) are not typing.</summary>
    private void NoteTyping(string data)
    {
        if (data.Length == 0 || (data[0] == '\u001b' && !data.StartsWith("\u001b[200~", StringComparison.Ordinal))) return;
        lock (_gate)
        {
            _typedAt = DateTimeOffset.UtcNow;
            var cleared = data.LastIndexOfAny(['\r', '\u0003', '\u0015']);
            _draft = cleared < 0 ? true : data[(cleared + 1)..].Any(c => !char.IsControl(c));
        }
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
            Interlocked.Increment(ref _injecting);
            var typed = _injectChain.ContinueWith(_ => InjectOnce(text, attempts, wait), TaskScheduler.Default).Unwrap();
            typed.ContinueWith(_ => Interlocked.Decrement(ref _injecting), TaskScheduler.Default);
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

    private void OnOutput(long spawn, string chunk)
    {
        lock (_gate)
        {
            if (spawn != _spawn) return;
            _tap.Feed(chunk);
            _narrowestPrinted = Math.Min(_narrowestPrinted, _cols);
            foreach (var consumer in _consumers) consumer.Channel.Writer.TryWrite(chunk);
        }
    }

    private void OnExit(long spawn)
    {
        AgentConsumer[] targets;
        lock (_gate)
        {
            if (spawn != _spawn) return;
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

    /// <summary>Called with the agent id when the user cleared a registered session's conversation.</summary>
    public Action<string>? Cleared { get; set; }

    /// <summary>Every agent whose status payload just changed.</summary>
    public List<string> PollStatuses()
    {
        List<KeyValuePair<string, AgentSession>> snapshot;
        lock (_lock) snapshot = [.. _sessions];
        return snapshot.Where(kv => kv.Value.PollStatus()).Select(kv => kv.Key).ToList();
    }

    /// <summary>Spawns the agent, or returns the session already running for it.</summary>
    public AgentSession Start(string agentId, IReadOnlyList<string> argv, string cwd, string kind = "claude", IReadOnlyDictionary<string, string>? env = null, Stores.UserPaths? paths = null, string? banner = null, ClearWatch? clear = null)
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
                var session = new AgentSession(agentId, new PtyLaunch([executable, .. argv.Skip(1)], cwd, spawnEnv), kind, banner, OnSessionExit, clear, OnSessionClear);
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

    private void OnSessionClear(AgentSession session)
    {
        bool current;
        lock (_lock) current = _sessions.GetValueOrDefault(session.AgentId) == session;
        if (current) Cleared?.Invoke(session.AgentId);
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

    /// <summary>Restarts a live agent's process in place (WidenResume); false when it cannot start, leaving the old process running.</summary>
    public bool Respawn(string agentId, IReadOnlyList<string> argv, string cwd, IReadOnlyDictionary<string, string>? env, Stores.UserPaths? paths = null)
    {
        if (Get(agentId) is not { IsAlive: true } session || argv.Count == 0 || !Directory.Exists(cwd)) return false;
        string executable;
        try { executable = CliResolver.Resolve(argv[0], paths); }
        catch (CliLookupException) { return false; }
        return session.Respawn([executable, .. argv.Skip(1)], cwd, runtime.TerminalEnv(env));
    }

    /// <summary>Every registered session, live or exited.</summary>
    public List<AgentSession> All()
    {
        lock (_lock) return [.. _sessions.Values];
    }

    public void Dispose() => StopAll();
}
