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
    public const string StatusRunning = "running";
    public const string StatusExited = "exited";

    private readonly object _gate = new();
    private readonly List<AgentConsumer> _consumers = [];
    private readonly ScreenTap _tap = new(PtyLaunch.DefaultRows, PtyLaunch.DefaultCols);
    private readonly StatusDetector _detector;
    private readonly PtyHost _pty;
    private int? _exitCode;

    public AgentSession(string agentId, PtyLaunch launch, string kind = "claude", string? banner = null)
    {
        AgentId = agentId;
        Argv = [.. launch.Argv];
        _detector = new StatusDetector(StatusRules.ForKind(kind));
        // callbacks take _gate, so none can observe _pty before it is assigned
        lock (_gate)
        {
            _pty = PtyHost.Start(launch, OnOutput, OnExit);
            if (banner is not null) _tap.Feed(banner);
        }
    }

    public string AgentId { get; }

    public IReadOnlyList<string> Argv { get; }

    public int Pid => _pty.Pid;

    public int? ExitCode
    {
        get { lock (_gate) return _exitCode; }
    }

    public bool IsAlive => ExitCode is null;

    public ScreenTap Screen => _tap;

    /// <summary>"exited" once the process is gone; while it runs, what the detector last settled on.</summary>
    public string Status => IsAlive ? _detector.Status : StatusExited;

    /// <summary>The detector's verdict, or null when nothing changed: the LED's one source of truth.</summary>
    public string? PollStatus() =>
        IsAlive ? _detector.Observe(_tap.Tail(_detector.Rules.TailLines), _tap.Title, _tap.Progress, process: null) : null;

    /// <summary>A consumer seeded with a screen redraw, so a reattach can never start mid-sequence.</summary>
    public AgentConsumer Attach()
    {
        var consumer = new AgentConsumer();
        lock (_gate)
        {
            consumer.Channel.Writer.TryWrite(_tap.Render());
            if (_exitCode is not null) consumer.Channel.Writer.TryComplete();
            else _consumers.Add(consumer);
        }
        return consumer;
    }

    /// <summary>Redraws one consumer, so a client that just reported its own size sees that geometry.</summary>
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
    /// corrupt whatever it is already doing.
    /// </summary>
    public Task InjectWhenIdle(string text, int attempts = 60, TimeSpan? interval = null)
    {
        var wait = interval ?? TimeSpan.FromMilliseconds(500);
        return Task.Run(async () =>
        {
            for (var attempt = 0; attempt < attempts; attempt++)
            {
                if (ExitCode is not null) return;
                var verdict = _detector.Classify(_tap.Tail(_detector.Rules.TailLines), _tap.Title, _tap.Progress, null);
                if (verdict == StatusDetector.Idle)
                {
                    Write(text + "\r");
                    return;
                }
                await Task.Delay(wait);
            }
        });
    }

    /// <summary>Kills the process; the exit callback then completes every consumer.</summary>
    public void Close() => _pty.Close();

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
            targets = [.. _consumers];
            _consumers.Clear();
        }
        foreach (var consumer in targets) consumer.Channel.Writer.TryComplete();
    }
}

/// <summary>Every live agent PTY, keyed by agent id: the one place their processes are tracked.</summary>
public sealed class AgentSessionRegistry : IDisposable
{
    private readonly Dictionary<string, AgentSession> _sessions = [];
    private readonly object _lock = new();

    public AgentSession? Get(string agentId)
    {
        lock (_lock) return _sessions.GetValueOrDefault(agentId);
    }

    /// <summary>Every agent whose status just changed, as (id, status).</summary>
    public List<(string Id, string Status)> PollStatuses()
    {
        List<KeyValuePair<string, AgentSession>> snapshot;
        lock (_lock) snapshot = [.. _sessions];
        return snapshot.Select(kv => (kv.Key, Status: kv.Value.PollStatus())).Where(x => x.Status is not null).Select(x => (x.Key, x.Status!)).ToList();
    }

    /// <summary>Spawns the agent, or returns the session already running for it.</summary>
    public AgentSession Start(string agentId, IReadOnlyList<string> argv, string cwd, string kind = "claude", IReadOnlyDictionary<string, string>? env = null, Stores.UserPaths? paths = null, string? banner = null)
    {
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
                var session = new AgentSession(agentId, new PtyLaunch([executable, .. argv.Skip(1)], cwd, env), kind, banner);
                _sessions[agentId] = session;
                return session;
            }
            catch (Exception error) when (error is not OutOfMemoryException)
            {
                throw new AgentStartException($"Resolved CLI '{executable}', but process launch failed: {error.Message}");
            }
        }
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
