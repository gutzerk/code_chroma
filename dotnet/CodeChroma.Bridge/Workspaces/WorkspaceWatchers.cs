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
    private readonly Debouncer _impactChanges;
    private readonly Debouncer _wikiGeneral;
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
        _custom = new Debouncer(TimeSpan.FromMilliseconds(BridgeLimits.WatcherDebounceMs), () => EmitWithCanvas("custom"));
        _featurePlans = new Debouncer(TimeSpan.FromMilliseconds(BridgeLimits.WatcherDebounceMs), () => EmitWithCanvas("feature-plan"));
        _impactChanges = new Debouncer(TimeSpan.FromMilliseconds(BridgeLimits.WatcherDebounceMs), () => workspace.Emit(new JsonObject { ["type"] = "impact-changes" }));
        _wikiGeneral = new Debouncer(TimeSpan.FromMilliseconds(BridgeLimits.WatcherDebounceMs), () => workspace.EmitWiki(new JsonObject { ["type"] = "wiki-general" }));
        _traces = new Debouncer(TimeSpan.FromMilliseconds(BridgeLimits.WatcherDebounceMs), () => workspace.Emit(new JsonObject { ["type"] = "trace" }));
        _canvas = new Debouncer(TimeSpan.FromMilliseconds(BridgeLimits.WatcherDebounceMs), () => workspace.Emit(new JsonObject { ["type"] = "canvas" }));
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

    private void EmitWithCanvas(string type)
    {
        _workspace.Emit(new JsonObject { ["type"] = type });
        _workspace.Emit(new JsonObject { ["type"] = "canvas" });
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
                var paths = new[] { Path.Combine(directory, Path.GetFileName(directory) + ".json"), Path.Combine(directory, "projection.json") };
                if (paths.Any(path => UnderNewDirectory(path) && File.Exists(path))) debouncer.Trigger();
            }
        }
        foreach (var (path, debouncer) in new[] { (ImpactChangesPath, _impactChanges), (WikiGeneralIndexPath, _wikiGeneral) })
            if (UnderNewDirectory(path) && File.Exists(path)) debouncer.Trigger();
        var traces = _workspace.TracesDir + Path.DirectorySeparatorChar;
        if (UnderNewDirectory(traces) && Directory.Exists(traces) && Directory.EnumerateFiles(traces).Any())
            _traces.Trigger();
    }

    private string ImpactChangesPath => Path.Combine(_workspace.Root, ".codechroma", "impact-changes.json");

    private string WikiGeneralIndexPath => Path.Combine(_workspace.Root, ".codechroma", "wiki-general", "index.md");

    private void Route(string fullPath)
    {
        var parts = Path.GetRelativePath(_workspace.Root, fullPath).Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (parts is [".codechroma", "diagrams", var kind, var file] && file == kind + ".json" && _diagrams.TryGetValue(kind, out var diagram))
        {
            diagram.Trigger();
            return;
        }
        if (parts is [".codechroma", "diagrams", "custom", var customType, var customFile] && (customFile == customType + ".json" || customFile == "projection.json"))
        {
            _custom.Trigger();
            return;
        }
        if (parts is [".codechroma", "diagrams", "feature-plan", var planType, var planFile] && (planFile == planType + ".json" || planFile == "projection.json"))
        {
            _featurePlans.Trigger();
            return;
        }
        if (parts is [".codechroma", "impact-changes.json"])
        {
            _impactChanges.Trigger();
            return;
        }
        if (parts is [".codechroma", "wiki-general", "index.md"])
        {
            if (_workspace.OwnsWiki) _wikiGeneral.Trigger();
            return;
        }
        if (parts is [".codechroma", "canvas-core.json"] or [".codechroma", "diagrams", _, "projection.json"])
        {
            _canvas.Trigger();
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
        if (_workspace.OwnsWiki && _workspace.HeadChanged()) _workspace.EmitWiki(new JsonObject { ["type"] = "wiki-general" });
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
        _impactChanges.Dispose();
        _wikiGeneral.Dispose();
        _featurePlans.Dispose();
        foreach (var d in _diagrams.Values) d.Dispose();
    }
}
