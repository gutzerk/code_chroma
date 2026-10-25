using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Workspaces;

/// <summary>One recursive FileSystemWatcher per workspace, routed to a repo debouncer or a per-diagram one.</summary>
public sealed class WorkspaceWatchers : IDisposable
{
    private readonly Workspace _workspace;
    private readonly FileSystemWatcher _watcher;
    private readonly Debouncer _repo;
    private readonly Dictionary<string, Debouncer> _diagrams = [];
    private readonly Debouncer _custom;
    private readonly Debouncer _featurePlans;
    private readonly Debouncer _traces;
    private readonly Debouncer _canvas;
    private readonly Debouncer _newDirectories;
    private readonly HashSet<string> _pendingDirectories = [];

    public WorkspaceWatchers(Workspace workspace)
    {
        _workspace = workspace;
        _repo = new Debouncer(TimeSpan.FromMilliseconds(BridgeLimits.RepoDebounceMs), OnRepoChange);
        foreach (var kind in Workspace.DiagramKinds)
            _diagrams[kind] = new Debouncer(TimeSpan.FromMilliseconds(BridgeLimits.WatcherDebounceMs), () => workspace.Emit(new JsonObject { ["type"] = kind }));
        _canvas = new Debouncer(TimeSpan.FromMilliseconds(BridgeLimits.WatcherDebounceMs), () => workspace.Emit(new JsonObject { ["type"] = "canvas" }));
        // A custom or feature-plan type's own projection.json sits in the dir these watch, so each also pings the canvas.
        _custom = new Debouncer(TimeSpan.FromMilliseconds(BridgeLimits.WatcherDebounceMs), () =>
        {
            workspace.Emit(new JsonObject { ["type"] = "custom" });
            workspace.Emit(new JsonObject { ["type"] = "canvas" });
        });
        _featurePlans = new Debouncer(TimeSpan.FromMilliseconds(BridgeLimits.WatcherDebounceMs), () =>
        {
            workspace.Emit(new JsonObject { ["type"] = "feature-plan" });
            workspace.Emit(new JsonObject { ["type"] = "canvas" });
        });
        _traces = new Debouncer(TimeSpan.FromMilliseconds(BridgeLimits.WatcherDebounceMs), () => workspace.Emit(new JsonObject { ["type"] = "trace" }));
        _newDirectories = new Debouncer(TimeSpan.FromMilliseconds(BridgeLimits.WatcherDebounceMs), NotifyNewDirectories);
        _watcher = new FileSystemWatcher(workspace.Root)
        {
            IncludeSubdirectories = true,
            InternalBufferSize = 64 * 1024,
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.Size,
        };
        _watcher.Changed += (_, e) => Route(e.FullPath);
        _watcher.Created += (_, e) =>
        {
            Route(e.FullPath);
            if (!Directory.Exists(e.FullPath)) return;
            lock (_pendingDirectories) _pendingDirectories.Add(e.FullPath + Path.DirectorySeparatorChar);
            _newDirectories.Trigger();
        };
        _watcher.Deleted += (_, e) => Route(e.FullPath);
        _watcher.Error += (_, _) => _repo.Trigger();
        _watcher.Renamed += (_, e) => { Route(e.OldFullPath); Route(e.FullPath); };
    }

    public void Start() => _watcher.EnableRaisingEvents = true;

    private void NotifyNewDirectories()
    {
        string[] directories;
        lock (_pendingDirectories)
        {
            directories = _pendingDirectories.ToArray();
            _pendingDirectories.Clear();
        }
        // On Linux, files can be written before inotify attaches to a newly created directory.
        // Recheck known artifacts after the burst of directory creation has settled.
        bool UnderNewDirectory(string path) => directories.Any(directory => path.StartsWith(directory, StringComparison.Ordinal));
        foreach (var kind in Workspace.DiagramKinds)
        {
            var path = _workspace.DiagramPath(kind);
            if (UnderNewDirectory(path) && File.Exists(path)) _diagrams[kind].Trigger();
        }
        foreach (var (folder, debouncer) in new[] { ("custom", _custom), ("feature-plan", _featurePlans) })
        {
            var folderPath = Path.Combine(_workspace.Root, ".codechroma", "diagrams", folder);
            if (!Directory.Exists(folderPath)) continue;
            foreach (var directory in Directory.EnumerateDirectories(folderPath))
            {
                var path = Path.Combine(directory, Path.GetFileName(directory) + ".json");
                if (UnderNewDirectory(path) && File.Exists(path)) debouncer.Trigger();
            }
        }
        var traces = _workspace.TracesDir + Path.DirectorySeparatorChar;
        if (UnderNewDirectory(traces) && Directory.Exists(traces) && Directory.EnumerateFiles(traces).Any())
            _traces.Trigger();
    }

    private void Route(string fullPath)
    {
        var parts = Path.GetRelativePath(_workspace.Root, fullPath).Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (parts is [".codechroma", "diagrams", var kind, var file] && file == kind + ".json" && _diagrams.TryGetValue(kind, out var diagram))
        {
            diagram.Trigger();
            return;
        }
        // Backstop for a canvas write that skipped PATCH /canvas: the core file and each built-in kind's projection.
        if (parts is [".codechroma", "canvas-core.json"]
            || (parts is [".codechroma", "diagrams", var projectionKind, "projection.json"] && _diagrams.ContainsKey(projectionKind)))
        {
            _canvas.Trigger();
            return;
        }
        if (parts is [".codechroma", "diagrams", "custom", var customType, var customFile] && (customFile == customType + ".json" || customFile == "projection.json"))
        {
            _custom.Trigger();
            return;
        }
        if (parts is [".codechroma", "diagrams", "feature-plan", var slug, var planFile] && (planFile == slug + ".json" || planFile == "projection.json"))
        {
            _featurePlans.Trigger();
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
        _newDirectories.Dispose();
        _traces.Dispose();
        _canvas.Dispose();
        _custom.Dispose();
        _featurePlans.Dispose();
        foreach (var d in _diagrams.Values) d.Dispose();
    }
}
