using System.Text.Json;

namespace CodeChroma.Canvas.State;

/// <summary>Where per-viewer conveniences persist (localStorage/sessionStorage in the web); may throw.</summary>
public interface IKeyValueStore
{
    string? Get(string key);
    void Set(string key, string value);
}

/// <summary>Stores that reset when the workspace switches register here (resetWorkspaceStores).</summary>
public sealed class WorkspaceStoreRegistry
{
    private readonly List<Action> _resets = new();
    public void Register(Action reset) => _resets.Add(reset);
    public void ResetAll() { foreach (var reset in _resets) reset(); }
}

/// <summary>Which diagram layers are hidden without being deleted; persisted per workspace, never touches the document.</summary>
public sealed class CollapsedLayersStore
{
    private const string Prefix = "codechroma.collapsedLayers";
    private readonly IKeyValueStore _storage;
    private readonly Func<string> _activeWorkspace;
    private HashSet<string> _collapsed;

    public CollapsedLayersStore(IKeyValueStore storage, Func<string> activeWorkspace, WorkspaceStoreRegistry registry)
    {
        _storage = storage;
        _activeWorkspace = activeWorkspace;
        _collapsed = Read();
        registry.Register(Reset);
    }

    public event Action? Changed;

    public IReadOnlyCollection<string> Collapsed => _collapsed;

    public bool IsCollapsed(string layer) => _collapsed.Contains(layer);

    public void Collapse(string layer)
    {
        if (!_collapsed.Add(layer)) return;
        Persist();
        Changed?.Invoke();
    }

    public void Expand(string layer)
    {
        if (!_collapsed.Remove(layer)) return;
        Persist();
        Changed?.Invoke();
    }

    public void Toggle(string layer)
    {
        if (IsCollapsed(layer)) Expand(layer);
        else Collapse(layer);
    }

    /// <summary>Loads the active workspace's persisted collapses into memory.</summary>
    public void Load()
    {
        _collapsed = Read();
        Changed?.Invoke();
    }

    /// <summary>Clears the in-memory set only; the persisted value stays for the next Load.</summary>
    public void Reset()
    {
        if (_collapsed.Count == 0) return;
        _collapsed = new HashSet<string>();
        Changed?.Invoke();
    }

    private string Key => $"{Prefix}.{_activeWorkspace()}";

    private HashSet<string> Read()
    {
        try
        {
            var raw = _storage.Get(Key);
            if (string.IsNullOrEmpty(raw)) return new HashSet<string>();
            return JsonSerializer.Deserialize<string[]>(raw)?.ToHashSet() ?? new HashSet<string>();
        }
        catch (Exception)
        {
            return new HashSet<string>();
        }
    }

    private void Persist()
    {
        try { _storage.Set(Key, JsonSerializer.Serialize(_collapsed)); }
        catch (Exception) { /* best effort: a failed write only loses the restore */ }
    }
}

public readonly record struct LiveDragOffset(double X, double Y);

/// <summary>The in-flight drag offsets, so arrows follow a box's live position instead of its last saved one.</summary>
public sealed class DragOffsetStore
{
    private Dictionary<string, LiveDragOffset> _offsets = new();

    public event Action? Changed;

    public IReadOnlyDictionary<string, LiveDragOffset> All => _offsets;

    public void Set(string id, LiveDragOffset offset)
    {
        if (_offsets.TryGetValue(id, out var existing) && existing == offset) return;
        _offsets = new Dictionary<string, LiveDragOffset>(_offsets) { [id] = offset };
        Changed?.Invoke();
    }

    /// <summary>One merge and one notification for a whole group drag.</summary>
    public void SetMany(IReadOnlyDictionary<string, LiveDragOffset> entries)
    {
        if (entries.Count == 0) return;
        var next = new Dictionary<string, LiveDragOffset>(_offsets);
        foreach (var (id, offset) in entries) next[id] = offset;
        _offsets = next;
        Changed?.Invoke();
    }

    public void Clear(string id)
    {
        if (!_offsets.ContainsKey(id)) return;
        _offsets = _offsets.Where(kv => kv.Key != id).ToDictionary(kv => kv.Key, kv => kv.Value);
        Changed?.Invoke();
    }

    public void Reset()
    {
        _offsets = new Dictionary<string, LiveDragOffset>();
        Changed?.Invoke();
    }
}

/// <summary>Remembers a layer's positions across a remove-then-re-add cycle, keyed by recipe_key; entries are consumed on read.</summary>
public sealed class LayerPositionCache
{
    private readonly Dictionary<string, Dictionary<string, Position>> _cache = new();

    public void Capture(IReadOnlyCollection<CanvasElement> layerElements, string layer)
    {
        var snapshot = new Dictionary<string, Position>();
        foreach (var element in layerElements)
            if (ElementMeta.String(element, "recipe_key") is { } key) snapshot[key] = element.Position;
        if (snapshot.Count > 0) _cache[layer] = snapshot;
        else _cache.Remove(layer);
    }

    public void Seed(string layer, IReadOnlyDictionary<string, Position> positions) =>
        _cache[layer] = new Dictionary<string, Position>(positions);

    public Position? Take(string layer, string recipeKey)
    {
        if (!_cache.TryGetValue(layer, out var snapshot) || !snapshot.Remove(recipeKey, out var position)) return null;
        if (snapshot.Count == 0) _cache.Remove(layer);
        return position;
    }
}

/// <summary>Survives a reload so the stale-fingerprint check has a real "before" on the first fetch.</summary>
public sealed class DiagramStatusCache
{
    private const string Key = "codechroma.diagramsStatusCache";
    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private readonly IKeyValueStore _storage;

    public DiagramStatusCache(IKeyValueStore storage) => _storage = storage;

    public DiagramsStatus? Read()
    {
        try
        {
            var raw = _storage.Get(Key);
            if (raw is null) return null;
            var entries = JsonSerializer.Deserialize<Dictionary<string, DiagramStatusEntry>>(raw, Options);
            return entries is null ? null : new DiagramsStatus(entries);
        }
        catch (Exception)
        {
            return null;
        }
    }

    public void Write(DiagramsStatus status)
    {
        try { _storage.Set(Key, JsonSerializer.Serialize(status.Entries, Options)); }
        catch (Exception) { /* losing the cache only means the next reload starts from a fresh baseline */ }
    }
}

public sealed record DiagramStatusPlan(IReadOnlyList<string> Arrived, IReadOnlyList<string> Stale);

/// <summary>Decides which diagrams to (re)run after a status refetch: just-arrived ones not yet placed, and placed ones whose fingerprint changed.</summary>
public static class DiagramStatusPlanner
{
    public static DiagramStatusPlan Plan(DiagramsStatus? before, DiagramsStatus next, ISet<string> placed)
    {
        if (before is null) return new DiagramStatusPlan(Array.Empty<string>(), Array.Empty<string>());
        var arrived = next.Entries
            .Where(kv => kv.Value.Ready && !(before.Entries.TryGetValue(kv.Key, out var b) && b.Ready) && !placed.Contains(kv.Key))
            .Select(kv => kv.Key).ToList();
        var stale = next.Entries
            .Where(kv =>
            {
                if (!placed.Contains(kv.Key) || !kv.Value.Ready) return false;
                var nextFp = kv.Value.Fingerprint;
                var beforeFp = before.Entries.TryGetValue(kv.Key, out var b) ? b.Fingerprint : null;
                return nextFp is not null && beforeFp is not null && nextFp != beforeFp;
            })
            .Select(kv => kv.Key).ToList();
        return new DiagramStatusPlan(arrived, stale);
    }
}

/// <summary>The soft diagnostics a drawn diagram carries, shown beside it; cleared when the diagram goes.</summary>
public sealed class DiagramHealthStore
{
    private readonly Dictionary<string, IReadOnlyList<string>> _notes = new();
    public void Set(string layer, IReadOnlyList<string> notes) => _notes[layer] = notes;
    public IReadOnlyList<string> Get(string layer) => _notes.TryGetValue(layer, out var n) ? n : Array.Empty<string>();
    public void Clear(string layer) => _notes.Remove(layer);
}
