using System.Text.Json.Nodes;
using CodeChroma.Bridge.Engine;

namespace CodeChroma.Bridge.Workspaces;

public sealed record WorkspaceState(string State, string Progress, string? Error);

/// <summary>One analyzed root: its engine, git-status sync, skill-job state and file watchers.</summary>
public sealed class Workspace : IDisposable
{
    public const string MainId = "main";
    public static readonly IReadOnlyList<string> DiagramKinds = ["c1", "patterns", "impact", "epics", "sequence"];

    private readonly Action<string, JsonObject> _onEvent;
    private readonly object _syncLock = new();
    private string? _lastSignature;
    private string? _lastHead;
    private WorkspaceWatchers? _watchers;

    public Workspace(string id, string root, IGraphEngine engine, Action<string, JsonObject> onEvent, bool readOnly = false)
    {
        Id = id;
        Root = Path.GetFullPath(root);
        Engine = engine;
        ReadOnly = readOnly;
        _onEvent = onEvent;
        _lastHead = CurrentHead();
    }

    public string Id { get; }
    public string Root { get; }
    public IGraphEngine Engine { get; }
    public bool ReadOnly { get; }

    /// <summary>The ref diffs compare against instead of the default branch (a PR review's fetched base).</summary>
    public string? BaseRef { get; init; }

    /// <summary>Where C1 is read through from (a PR borrows main's), when it is not this root.</summary>
    public string? C1SourceRoot { get; init; }
    public WorkspaceState State { get; } = new("ready", "", null);

    public string TracesDir => Path.Combine(Root, ".codechroma", "traces");

    public string DiagramPath(string kind) => Path.Combine(Root, ".codechroma", "diagrams", kind, Path.GetFileName(kind) + ".json");

    /// <summary>Pings connected canvases; main's pings stay bare, others carry their workspace id.</summary>
    public void Emit(JsonObject message)
    {
        if (Id != MainId) message["workspace"] = Id;
        _onEvent(Id, message);
    }

    public string? CurrentHead() => GitRunner.Run(Root, "rev-parse", "HEAD")?.Trim();

    /// <summary>Reanalyzes what git reports changed since the last call; null when nothing new.</summary>
    public List<string>? Sync()
    {
        lock (_syncLock)
        {
            var status = GitRunner.Run(Root, "status", "--porcelain", "--untracked-files=all", "--", ".");
            if (status is null) return null;
            var prefix = (GitRunner.Run(Root, "rev-parse", "--show-prefix") ?? "").Trim();
            var changed = new List<string>();
            foreach (var raw in GitRunner.PorcelainPaths(status))
            {
                var rel = raw;
                if (prefix.Length > 0)
                {
                    if (!raw.StartsWith(prefix, StringComparison.Ordinal)) continue;
                    rel = raw[prefix.Length..];
                }
                if (rel.Split('/').Contains(".codechroma")) continue;
                changed.Add(rel);
            }
            var signature = string.Join("|", changed.Order(StringComparer.Ordinal).Select(rel => $"{rel}:{MtimeTicks(rel)}"));
            if (signature == _lastSignature) return null;
            _lastSignature = signature;
            if (changed.Count > 0) Engine.Reanalyze(changed);
            return changed;
        }
    }

    private long MtimeTicks(string rel)
    {
        try { return File.GetLastWriteTimeUtc(Path.Combine(Root, rel)).Ticks; }
        catch (IOException) { return -1; }
    }

    /// <summary>True once per HEAD move (commit, checkout, merge, reset, pull).</summary>
    public bool HeadChanged()
    {
        lock (_syncLock)
        {
            var head = CurrentHead();
            if (head is null || head == _lastHead) return false;
            _lastHead = head;
            return true;
        }
    }

    public void StartWatchers() => (_watchers ??= new WorkspaceWatchers(this)).Start();

    public void StopWatchers() => _watchers?.Dispose();

    public void Dispose() => StopWatchers();
}
