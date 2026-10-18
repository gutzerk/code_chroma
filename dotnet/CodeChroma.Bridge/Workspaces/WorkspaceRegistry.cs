using System.Text.Json.Nodes;
using CodeChroma.Bridge.Engine;

namespace CodeChroma.Bridge.Workspaces;

/// <summary>Maps a repo id onto a Workspace: main at startup, registered ones lazy and unloaded when idle.</summary>
public sealed class WorkspaceRegistry : IDisposable
{
    private readonly IEngineFactory _factory;
    private readonly Action<string, JsonObject> _onEvent;
    private readonly TimeProvider _time;
    private readonly bool _startWatchers;
    private readonly Dictionary<string, (string Root, bool ReadOnly)> _roots = [];
    private readonly Dictionary<string, RootExtras> _extras = [];
    private readonly Dictionary<string, string> _canonical = [];
    private readonly Dictionary<string, Workspace> _live = [];
    private readonly Dictionary<string, long> _touched = [];
    private readonly Dictionary<string, WorkspaceState> _states = [];
    private readonly Dictionary<string, Lazy<Workspace>> _pending = [];
    private readonly object _lock = new();

    public WorkspaceRegistry(string mainRoot, IEngineFactory factory, Action<string, JsonObject> onEvent, TimeProvider time, bool startWatchers)
    {
        _factory = factory;
        _onEvent = onEvent;
        _time = time;
        _startWatchers = startWatchers;
        _roots[Workspace.MainId] = (mainRoot, false);
        Main = Create(Workspace.MainId);
        lock (_lock) Publish(Workspace.MainId, Main);
    }

    public Workspace Main { get; }

    public bool IsRegistered(string id)
    {
        lock (_lock) return _roots.ContainsKey(id);
    }

    public bool IsReadOnly(string id)
    {
        lock (_lock) return _roots.TryGetValue(id, out var entry) && entry.ReadOnly;
    }

    public bool IsLive(string id)
    {
        lock (_lock) return _live.ContainsKey(id);
    }

    /// <summary>Extra facts about a registered root: the ref diffs compare against and where C1 reads from.</summary>
    public sealed record RootExtras(string? BaseRef, string? C1SourceRoot);

    /// <summary>`sharesWorkspaceWith` makes this id an alias of another registered id's live workspace (attach-created agents).</summary>
    public void Register(string id, string root, bool readOnly = false, string? baseRef = null, string? c1SourceRoot = null, string? sharesWorkspaceWith = null)
    {
        lock (_lock)
        {
            _roots[id] = (root, readOnly);
            _extras[id] = new RootExtras(baseRef, c1SourceRoot);
            if (sharesWorkspaceWith is null) _canonical.Remove(id);
            else _canonical[id] = _canonical.GetValueOrDefault(sharesWorkspaceWith, sharesWorkspaceWith);
        }
    }

    /// <summary>The directory a registered id lives in; null when nothing is registered under it.</summary>
    public string? RootFor(string id)
    {
        lock (_lock) return _roots.TryGetValue(id, out var entry) ? entry.Root : null;
    }

    public RootExtras? ExtrasFor(string id)
    {
        lock (_lock) return _extras.GetValueOrDefault(id);
    }

    /// <summary>Unloads a live workspace but keeps its registration, so the next access re-analyzes it.</summary>
    public bool DropLive(string id)
    {
        if (id == Workspace.MainId) return false;
        Workspace? workspace;
        lock (_lock)
        {
            if (!_live.Remove(id, out workspace)) return false;
            _touched.Remove(id);
            _states.Remove(id);
        }
        workspace.Dispose();
        return true;
    }

    /// <summary>Forgets a registration and unloads the workspace; main is never forgotten.</summary>
    public void Unregister(string id)
    {
        if (id == Workspace.MainId) return;
        DropLive(id);
        lock (_lock)
        {
            _pending.Remove(id);
            _roots.Remove(id);
            _extras.Remove(id);
            _canonical.Remove(id);
            _states.Remove(id);
        }
    }

    /// <summary>The workspace for an id, brought up on first access; main for an unregistered id.</summary>
    public Workspace Get(string id)
    {
        Lazy<Workspace> pending;
        lock (_lock)
        {
            id = Canon(id);
            if (_live.TryGetValue(id, out var live))
            {
                _touched[id] = _time.GetTimestamp();
                return live;
            }
            if (!_roots.ContainsKey(id)) return Main;
            var key = id;
            if (!_pending.TryGetValue(id, out pending!))
                _pending[id] = pending = new Lazy<Workspace>(() => Create(key), LazyThreadSafetyMode.ExecutionAndPublication);
        }
        try
        {
            var built = pending.Value;
            lock (_lock)
            {
                if (_pending.GetValueOrDefault(id) == pending) _pending.Remove(id);
                if (_live.TryGetValue(id, out var winner)) return winner;
                if (!_roots.ContainsKey(id)) { built.Dispose(); return Main; }
                Publish(id, built);
                return built;
            }
        }
        catch
        {
            lock (_lock)
                if (_pending.GetValueOrDefault(id) == pending) _pending.Remove(id);
            throw;
        }
    }

    /// <summary>Starts a background bring-up and returns the current state, so the UI shows progress.</summary>
    public WorkspaceState EnsureAsync(string id)
    {
        lock (_lock)
        {
            id = Canon(id);
            if (!_roots.ContainsKey(id)) return new WorkspaceState("error", "", "unknown workspace");
            if (_live.ContainsKey(id)) { _touched[id] = _time.GetTimestamp(); return State(id); }
            _states[id] = new WorkspaceState("analyzing", "starting", null);
        }
        _ = Task.Run(() =>
        {
            try { Get(id); }
            catch (Exception error)
            {
                lock (_lock) _states[id] = new WorkspaceState("error", "", error.Message);
            }
        });
        lock (_lock) return State(id);
    }

    public WorkspaceState State(string id)
    {
        lock (_lock)
        {
            id = Canon(id);
            if (_live.TryGetValue(id, out var live)) return live.State;
            if (_states.TryGetValue(id, out var recorded)) return recorded;
            return _roots.ContainsKey(id)
                ? new WorkspaceState("analyzing", "not started", null)
                : new WorkspaceState("error", "", "unknown workspace");
        }
    }

    /// <summary>Drops workspaces nobody touched for the idle threshold; main is never dropped.</summary>
    public IReadOnlyList<string> UnloadIdle(TimeSpan? maxIdle = null)
    {
        var limit = maxIdle ?? TimeSpan.FromSeconds(BridgeLimits.IdleUnloadSeconds);
        var now = _time.GetTimestamp();
        var dropped = new List<string>();
        lock (_lock)
        {
            foreach (var (id, touched) in _touched.ToArray())
            {
                if (id == Workspace.MainId || _time.GetElapsedTime(touched, now) < limit) continue;
                if (_live.Remove(id, out var workspace))
                {
                    workspace.Dispose();
                    dropped.Add(id);
                }
                _touched.Remove(id);
                _states.Remove(id);
            }
        }
        return dropped;
    }

    public void StartAll()
    {
        lock (_lock)
            foreach (var workspace in _live.Values) workspace.StartWatchers();
    }

    private string Canon(string id) => _canonical.GetValueOrDefault(id, id);

    private Workspace Create(string id)
    {
        (string Root, bool ReadOnly) entry;
        RootExtras? extras;
        lock (_lock)
        {
            entry = _roots[id];
            extras = _extras.GetValueOrDefault(id);
        }
        var workspace = new Workspace(id, entry.Root, _factory.Create(entry.Root), _onEvent, entry.ReadOnly)
        {
            BaseRef = extras?.BaseRef,
            C1SourceRoot = extras?.C1SourceRoot,
        };
        // Offline and best-effort: the docstring wiki is written once, the first time a workspace comes up.
        Wiki.WikiBootstrap.IfMissing(workspace);
        return workspace;
    }

    private void Publish(string id, Workspace workspace)
    {
        _live[id] = workspace;
        _touched[id] = _time.GetTimestamp();
        if (_startWatchers && id != Workspace.MainId) workspace.StartWatchers();
    }

    public void Dispose()
    {
        lock (_lock)
            foreach (var workspace in _live.Values) workspace.Dispose();
    }
}
