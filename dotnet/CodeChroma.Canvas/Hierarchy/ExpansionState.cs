using System.Text.Json;

namespace CodeChroma.Canvas.Hierarchy;

/// <summary>
/// Which blocks are open and which show code (port of expansionState.ts): any number of siblings and depths at once, a
/// collapse cascades to open descendants, the deepest-open path drives the breadcrumb, and the open set persists per workspace.
/// </summary>
public sealed class ExpansionState
{
    private const string Prefix = "codechroma.expansion";
    private readonly IHierarchySource _source;
    private readonly IKeyValueStore? _storage;
    private readonly Func<string> _workspace;
    private readonly List<string> _expanded = new();
    private readonly List<string> _codeVisible = new();

    public ExpansionState(IHierarchySource source, IKeyValueStore? storage = null, Func<string>? workspace = null)
    {
        _source = source;
        _storage = storage;
        _workspace = workspace ?? (() => "default");
        Load();
    }

    public event Action? Changed;

    /// <summary>True only when a persisted snapshot came back (a restored tree must not be re-auto-expanded).</summary>
    public bool Restored { get; private set; }

    public IReadOnlyList<string> ExpandedOrder => _expanded;
    public IReadOnlyList<string> CodeVisibleOrder => _codeVisible;

    public bool IsExpanded(string id) => _expanded.Contains(id);
    public bool IsCodeVisible(string id) => _codeVisible.Contains(id);

    public void Expand(string id)
    {
        if (IsExpanded(id)) return;
        _expanded.Add(id);
        Commit();
    }

    public void Collapse(string id)
    {
        CollapseInternal(id);
        Commit();
    }

    public void Toggle(string id)
    {
        if (IsExpanded(id)) Collapse(id);
        else Expand(id);
    }

    public void ShowCode(string id)
    {
        if (!_codeVisible.Contains(id)) _codeVisible.Add(id);
        Commit();
    }

    public void HideCode(string id)
    {
        _codeVisible.Remove(id);
        Commit();
    }

    public void ToggleCode(string id)
    {
        if (IsCodeVisible(id)) HideCode(id);
        else ShowCode(id);
    }

    /// <summary>Root-first ids from the most recently expanded block up to the root.</summary>
    public IReadOnlyList<string> DeepestExpandedPath()
    {
        if (_expanded.Count == 0) return Array.Empty<string>();
        var path = new List<string>();
        for (string? id = _expanded[^1]; id is not null && path.Count < 64; id = _source.Get(id)?.ParentId)
            path.Insert(0, id);
        return path;
    }

    /// <summary>The nearest ancestor (or the node) whose box is actually on screen: every ancestor above it is open.</summary>
    public string NearestVisibleAncestor(string id)
    {
        var chain = new List<string>();
        for (string? cur = id; cur is not null && chain.Count < 64; cur = _source.Get(cur)?.ParentId) chain.Insert(0, cur);
        var visible = chain[0];
        for (var i = 1; i < chain.Count; i++)
        {
            if (chain[i - 1] == HierarchyIds.Root || IsExpanded(chain[i - 1])) visible = chain[i];
            else break;
        }
        return visible;
    }

    /// <summary>The open and code-visible sets at this moment, so a Diff reveal can be undone exactly.</summary>
    public Snapshot TakeSnapshot() => new(_expanded.ToList(), _codeVisible.ToList());

    /// <summary>Puts a snapshot back: whatever a reveal opened closes, whatever the user had open stays.</summary>
    public void Restore(Snapshot snapshot)
    {
        _expanded.Clear();
        _expanded.AddRange(snapshot.Expanded);
        _codeVisible.Clear();
        _codeVisible.AddRange(snapshot.CodeVisible);
        Commit();
    }

    /// <summary>Re-reads the active workspace's snapshot (a workspace switch).</summary>
    public void Load()
    {
        _expanded.Clear();
        _codeVisible.Clear();
        Restored = false;
        try
        {
            var raw = _storage?.Get(Key);
            if (!string.IsNullOrEmpty(raw) && JsonSerializer.Deserialize<Snapshot>(raw) is { } snap)
            {
                _expanded.AddRange(snap.Expanded);
                _codeVisible.AddRange(snap.CodeVisible);
                Restored = true;
            }
        }
        catch (Exception) { /* unreadable storage restores nothing */ }
        Changed?.Invoke();
    }

    private void CollapseInternal(string id)
    {
        _expanded.Remove(id);
        _codeVisible.Remove(id);
        foreach (var other in _expanded.ToList())
            if (IsDescendantOf(other, id)) CollapseInternal(other);
    }

    private bool IsDescendantOf(string id, string ancestor)
    {
        var cur = _source.Get(id)?.ParentId;
        for (var guard = 0; cur is not null && guard < 64; guard++)
        {
            if (cur == ancestor) return true;
            cur = _source.Get(cur)?.ParentId;
        }
        return false;
    }

    private void Commit()
    {
        try { _storage?.Set(Key, JsonSerializer.Serialize(new Snapshot(_expanded.ToList(), _codeVisible.ToList()))); }
        catch (Exception) { /* best effort: a failed write only loses the restore */ }
        Changed?.Invoke();
    }

    private string Key => $"{Prefix}.{_workspace()}";

    public sealed record Snapshot(List<string> Expanded, List<string> CodeVisible);
}
