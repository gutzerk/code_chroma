using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Workspaces;

/// <summary>One recursive FileSystemWatcher per workspace, routed to a repo debouncer or a per-diagram one.</summary>
public sealed class WorkspaceWatchers : IDisposable
{
    private readonly Workspace _workspace;
    private readonly FileSystemWatcher _watcher;
    private readonly Debouncer _repo;
    private readonly Dictionary<string, Debouncer> _diagrams = [];
    private readonly Debouncer _traces;

    public WorkspaceWatchers(Workspace workspace)
    {
        _workspace = workspace;
        _repo = new Debouncer(TimeSpan.FromMilliseconds(BridgeLimits.RepoDebounceMs), OnRepoChange);
        foreach (var kind in Workspace.DiagramKinds)
            _diagrams[kind] = new Debouncer(TimeSpan.FromMilliseconds(BridgeLimits.WatcherDebounceMs), () => workspace.Emit(new JsonObject { ["type"] = kind }));
        _traces = new Debouncer(TimeSpan.FromMilliseconds(BridgeLimits.WatcherDebounceMs), () => workspace.Emit(new JsonObject { ["type"] = "trace" }));
        _watcher = new FileSystemWatcher(workspace.Root)
        {
            IncludeSubdirectories = true,
            InternalBufferSize = 64 * 1024,
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.Size,
        };
        _watcher.Changed += (_, e) => Route(e.FullPath);
        _watcher.Created += (_, e) => Route(e.FullPath);
        _watcher.Deleted += (_, e) => Route(e.FullPath);
        _watcher.Renamed += (_, e) => { Route(e.OldFullPath); Route(e.FullPath); };
    }

    public void Start() => _watcher.EnableRaisingEvents = true;

    private void Route(string fullPath)
    {
        var parts = Path.GetRelativePath(_workspace.Root, fullPath).Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (parts is [".codechroma", "diagrams", var kind, var file] && file == kind + ".json" && _diagrams.TryGetValue(kind, out var diagram))
        {
            diagram.Trigger();
            return;
        }
        if (parts is [".codechroma", "traces", _])
        {
            _traces.Trigger();
            return;
        }
        if (parts.Any(BridgeLimits.IgnoredDirs.Contains)) return;
        _repo.Trigger();
    }

    private void OnRepoChange()
    {
        // A failed reanalysis (repo deleted underneath, analyzer crash) must never take the process down.
        try { Notify(); }
        catch (Exception) { }
    }

    private void Notify()
    {
        var changed = _workspace.Sync();
        if (changed is not null)
            _workspace.Emit(new JsonObject { ["type"] = "changed", ["paths"] = new JsonArray(changed.Select(p => (JsonNode?)p).ToArray()) });
        if (_workspace.HeadChanged()) _workspace.Emit(new JsonObject { ["type"] = "wiki-general" });
    }

    public void Dispose()
    {
        _watcher.EnableRaisingEvents = false;
        _watcher.Dispose();
        _repo.Dispose();
        _traces.Dispose();
        foreach (var d in _diagrams.Values) d.Dispose();
    }
}
