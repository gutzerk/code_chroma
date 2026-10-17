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
    private readonly Dictionary<string, Workspace> _live = [];
    private readonly Dictionary<string, long> _touched = [];
    private readonly Dictionary<string, WorkspaceState> _states = [];
    private readonly object _lock = new();

    public WorkspaceRegistry(string mainRoot, IEngineFactory factory, Action<string, JsonObject> onEvent, TimeProvider time, bool startWatchers)
    {
        _factory = factory;
        _onEvent = onEvent;
        _time = time;
        _startWatchers = startWatchers;
        _roots[Workspace.MainId] = (mainRoot, false);
        Main = BringUp(Workspace.MainId);
    }

    public Workspace Main { get; }

    public bool IsRegistered(string id) => _roots.ContainsKey(id);

    public bool IsReadOnly(string id) => _roots.TryGetValue(id, out var entry) && entry.ReadOnly;

    public bool IsLive(string id)
    {
        lock (_lock) return _live.ContainsKey(id);
    }

    public void Register(string id, string root, bool readOnly = false)
    {
        lock (_lock) _roots[id] = (root, readOnly);
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
            _roots.Remove(id);
            _states.Remove(id);
        }
    }

    /// <summary>The workspace for an id, brought up on first access; main for an unregistered id.</summary>
    public Workspace Get(string id)
    {
        lock (_lock)
        {
            if (_live.TryGetValue(id, out var live))
            {
                _touched[id] = _time.GetTimestamp();
                return live;
            }
            return _roots.ContainsKey(id) ? BringUp(id) : Main;
        }
    }

    /// <summary>Starts a background bring-up and returns the current state, so the UI shows progress.</summary>
    public WorkspaceState EnsureAsync(string id)
    {
        lock (_lock)
        {
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

    private Workspace BringUp(string id)
    {
        var (root, readOnly) = _roots[id];
        var workspace = new Workspace(id, root, _factory.Create(root), _onEvent, readOnly);
        _live[id] = workspace;
        _touched[id] = _time.GetTimestamp();
        if (_startWatchers && id != Workspace.MainId) workspace.StartWatchers();
        return workspace;
    }

    public void Dispose()
    {
        lock (_lock)
            foreach (var workspace in _live.Values) workspace.Dispose();
    }
}
