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
    private IReadOnlyList<string> _lastChanged = [];
    private string? _lastHead;
    private string? _integrationBranch;
    private WorkspaceWatchers? _watchers;

    public Workspace(string id, string root, IGraphEngine engine, Action<string, JsonObject> onEvent, bool readOnly = false)
    {
        Id = id;
        Root = Path.GetFullPath(root);
        Engine = engine;
        ReadOnly = readOnly;
        _onEvent = onEvent;
        _lastHead = OwnsWiki ? WikiCommit() : null;
    }

    public string Id { get; }
    public string Root { get; }
    public IGraphEngine Engine { get; }
    public bool ReadOnly { get; }

    /// <summary>The ref diffs compare against instead of the default branch (a PR review's fetched base).</summary>
    public string? BaseRef { get; init; }

    /// <summary>Where C1 is read through from (a PR borrows main's), when it is not this root.</summary>
    public string? C1SourceRoot { get; init; }
    /// <summary>Whose C1 diagram this workspace draws: the borrowed source root, else its own.</summary>
    public string C1Root => C1SourceRoot ?? Root;
    public WorkspaceState State { get; } = new("ready", "", null);

    public string TracesDir => Path.Combine(Root, ".codechroma", "traces");

    public string DiagramPath(string kind) => DiagramPath(Root, kind);

    /// <summary>The artifact file of a diagram kind (`custom/<id>` and `feature-plan/<slug>` included) under a repo root.</summary>
    public static string DiagramPath(string root, string kind) => Path.Combine(root, ".codechroma", "diagrams", kind, Path.GetFileName(kind) + ".json");

    /// <summary>Pings connected canvases; main's pings stay bare, others carry their workspace id.</summary>
    public void Emit(JsonObject message)
    {
        if (Id != MainId) message["workspace"] = Id;
        _onEvent(Id, message);
    }

    public string? CurrentHead() => GitRunner.Run(Root, "rev-parse", "HEAD")?.Trim();

    /// <summary>True when this workspace holds the project's wiki: main, or a read-only PR keeping its own; worktree tabs read main's.</summary>
    public bool OwnsWiki => Id == MainId || ReadOnly;

    /// <summary>Broadcasts a wiki ping to every tab; set on main by the registry, bare to this workspace when unset.</summary>
    public Action<JsonObject>? WikiEmit { get; set; }

    public void EmitWiki(JsonObject message)
    {
        if (WikiEmit is { } broadcast) broadcast(message);
        else Emit(message);
    }

    /// <summary>The commit the wikis are tracked against: the integration branch tip, else HEAD.</summary>
    public string? WikiCommit()
    {
        if (ReadOnly) return CurrentHead();
        var branch = _integrationBranch ??= Agents.WorktreeOps.MainBranch(Root);
        return GitRunner.Run(Root, "rev-parse", branch)?.Trim() is { Length: > 0 } tip ? tip : CurrentHead();
    }

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
            var refresh = changed.Union(_lastChanged, StringComparer.Ordinal).ToList();
            _lastChanged = changed;
            if (refresh.Count > 0) Engine.Reanalyze(refresh);
            return changed;
        }
    }

    private long MtimeTicks(string rel)
    {
        try { return File.GetLastWriteTimeUtc(Path.Combine(Root, rel)).Ticks; }
        catch (IOException) { return -1; }
    }

    /// <summary>True once per move of the tracked wiki commit (a commit, merge, reset or pull onto the integration branch).</summary>
    public bool HeadChanged()
    {
        lock (_syncLock)
        {
            var head = WikiCommit();
            if (head is null || head == _lastHead) return false;
            _lastHead = head;
            return true;
        }
    }

    public void StartWatchers() => (_watchers ??= new WorkspaceWatchers(this)).Start();

    public void StopWatchers() => _watchers?.Dispose();

    public void Dispose() => StopWatchers();
}
