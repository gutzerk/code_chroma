using System.Text.Json;

namespace CodeChroma.Canvas.State;

/// <summary>The multi-select set (port of selectionStore.ts): toggle, replace, union, clear; notifies only on a real change.</summary>
public sealed class SelectionModel
{
    private readonly HashSet<string> _selected = new();
    private readonly List<string> _order = new();

    public event Action? Changed;

    public IReadOnlyList<string> Ids => _order;
    public int Count => _selected.Count;
    public bool IsSelected(string id) => _selected.Contains(id);

    public void Toggle(string id)
    {
        if (!_selected.Remove(id)) { _selected.Add(id); _order.Add(id); }
        else _order.Remove(id);
        Changed?.Invoke();
    }

    public void Replace(IEnumerable<string> ids)
    {
        var next = ids.Distinct().ToList();
        if (next.Count == _selected.Count && next.All(_selected.Contains)) return;
        _selected.Clear();
        _order.Clear();
        foreach (var id in next) { _selected.Add(id); _order.Add(id); }
        Changed?.Invoke();
    }

    public void AddMany(IEnumerable<string> ids)
    {
        var added = false;
        foreach (var id in ids)
            if (_selected.Add(id)) { _order.Add(id); added = true; }
        if (added) Changed?.Invoke();
    }

    public void Clear()
    {
        if (_selected.Count == 0) return;
        _selected.Clear();
        _order.Clear();
        Changed?.Invoke();
    }

    /// <summary>Drops ids that no longer exist (a live reanalyze removed the box).</summary>
    public void Prune(Func<string, bool> exists)
    {
        var gone = _order.Where(id => !exists(id)).ToList();
        if (gone.Count == 0) return;
        foreach (var id in gone) { _selected.Remove(id); _order.Remove(id); }
        Changed?.Invoke();
    }
}

/// <summary>Rubber-band selection: which rectangles a marquee touches.</summary>
public static class Marquee
{
    public static Rect Normalize(Point a, Point b) =>
        new(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y), Math.Abs(a.X - b.X), Math.Abs(a.Y - b.Y));

    public static IReadOnlyList<string> Hits(Rect marquee, IEnumerable<(string Id, Rect Rect)> candidates) =>
        candidates.Where(c => c.Rect.Intersects(marquee)).Select(c => c.Id).ToList();
}

/// <summary>The per-kind layout undo history (port of undoStore.ts): pre-commit position maps, LIFO, capped, one shared clock.</summary>
public sealed class UndoHistory
{
    public const int Limit = 10;
    private readonly Dictionary<string, List<(int Seq, IReadOnlyDictionary<string, Position> Layout)>> _history = new();
    private int _sequence;

    public event Action? Changed;

    public bool CanUndo(string kind) => _history.TryGetValue(kind, out var s) && s.Count > 0;

    /// <summary>Records the layout as it stood BEFORE a commit, so undoing returns the boxes there.</summary>
    public void Record(string kind, IReadOnlyDictionary<string, Position> before)
    {
        if (!_history.TryGetValue(kind, out var stack)) _history[kind] = stack = new();
        stack.Add((++_sequence, before));
        if (stack.Count > Limit) stack.RemoveAt(0);
        Changed?.Invoke();
    }

    public IReadOnlyDictionary<string, Position>? Undo(string kind)
    {
        if (!_history.TryGetValue(kind, out var stack) || stack.Count == 0) return null;
        var top = stack[^1];
        stack.RemoveAt(stack.Count - 1);
        Changed?.Invoke();
        return top.Layout;
    }

    /// <summary>Pops whichever of the kinds recorded the most recent commit.</summary>
    public (string Kind, IReadOnlyDictionary<string, Position> Layout)? UndoLatest(IEnumerable<string> kinds)
    {
        string? best = null;
        var bestSeq = -1;
        foreach (var kind in kinds)
            if (_history.TryGetValue(kind, out var stack) && stack.Count > 0 && stack[^1].Seq > bestSeq) { best = kind; bestSeq = stack[^1].Seq; }
        if (best is null) return null;
        return (best, Undo(best)!);
    }

    public void Reset()
    {
        _history.Clear();
        _sequence = 0;
        Changed?.Invoke();
    }
}

/// <summary>Where the user dragged the top-level hierarchy boxes (the web's hierarchy layout map); persisted per workspace.</summary>
public sealed class TopLevelLayoutStore
{
    private const string Prefix = "codechroma.hierarchyLayout";
    private readonly IKeyValueStore? _storage;
    private readonly Func<string> _workspace;
    private Dictionary<string, Position> _positions = new();

    public TopLevelLayoutStore(IKeyValueStore? storage = null, Func<string>? workspace = null)
    {
        _storage = storage;
        _workspace = workspace ?? (() => "default");
        Load();
    }

    public event Action? Changed;

    public IReadOnlyDictionary<string, Position> Positions => _positions;

    /// <summary>Merges positions; the caller records the pre-commit map in the undo history.</summary>
    public void Apply(IReadOnlyDictionary<string, Position> positions)
    {
        var next = new Dictionary<string, Position>(_positions);
        foreach (var (id, p) in positions) next[id] = p;
        _positions = next;
        Persist();
        Changed?.Invoke();
    }

    public void Load()
    {
        _positions = new Dictionary<string, Position>();
        try
        {
            var raw = _storage?.Get($"{Prefix}.{_workspace()}");
            if (!string.IsNullOrEmpty(raw))
                _positions = JsonSerializer.Deserialize<Dictionary<string, Position>>(raw) ?? new();
        }
        catch (Exception) { /* unreadable storage restores nothing */ }
        Changed?.Invoke();
    }

    private void Persist()
    {
        try { _storage?.Set($"{Prefix}.{_workspace()}", JsonSerializer.Serialize(_positions)); }
        catch (Exception) { /* best effort */ }
    }
}
