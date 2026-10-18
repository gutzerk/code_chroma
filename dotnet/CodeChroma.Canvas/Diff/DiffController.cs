namespace CodeChroma.Canvas.Diff;

/// <summary>The two Diff-toggle layers (diffOverlayStore + changeCardStore + hierarchyChangesStore as one object, so they cannot disagree).</summary>
public sealed class DiffOverlay
{
    private Dictionary<string, FunctionDiff> _diffs = new();
    private Dictionary<string, List<ChangeCard>> _cards = new();
    private Dictionary<string, string> _statuses = new();
    private readonly Dictionary<string, IReadOnlyList<DiffLine>> _lines = new();

    public event Action? Changed;

    /// <summary>True once a Diff run published, even one that found nothing changed.</summary>
    public bool IsActive { get; private set; }

    public IReadOnlyCollection<FunctionDiff> Diffs => _diffs.Values;
    public IReadOnlyList<FunctionDiff> Deleted => _diffs.Values.Where(d => d.Status == "deleted").ToList();
    public IEnumerable<ChangeCard> AllCards => _cards.Values.SelectMany(c => c);

    /// <summary>The line diff of a node's function, computed once per published run instead of per paint.</summary>
    public IReadOnlyList<DiffLine> LinesOf(FunctionDiff diff)
    {
        lock (_lines)
        {
            if (!_lines.TryGetValue(diff.NodeId, out var lines)) _lines[diff.NodeId] = lines = LineDiff.Compute(diff.OriginalSource, diff.ProposedSource);
            return lines;
        }
    }

    public FunctionDiff? DiffOf(string nodeId) => _diffs.GetValueOrDefault(nodeId);
    public IReadOnlyList<ChangeCard> CardsOf(string nodeId) => _cards.TryGetValue(nodeId, out var c) ? c : Array.Empty<ChangeCard>();

    /// <summary>The block-recolor word for a node: added, modified or removed; unknown words are dropped on publish.</summary>
    public string? StatusOf(string nodeId) => _statuses.GetValueOrDefault(nodeId);

    public void Publish(IEnumerable<FunctionDiff> diffs, IEnumerable<ChangeCard> cards, IReadOnlyDictionary<string, string>? statuses)
    {
        lock (_lines) _lines.Clear();
        _diffs = diffs.ToDictionary(d => d.NodeId);
        _cards = cards.GroupBy(c => c.NodeId).ToDictionary(g => g.Key, g => g.ToList());
        _statuses = statuses is null
            ? new Dictionary<string, string>()
            : statuses.Where(kv => kv.Value is "added" or "modified" or "removed").ToDictionary(kv => kv.Key, kv => kv.Value);
        IsActive = true;
        Changed?.Invoke();
    }

    /// <summary>Drops every layer; the windows a run opened stay open, they just show plain code afterwards.</summary>
    public void Clear()
    {
        lock (_lines) _lines.Clear();
        _diffs = new();
        _cards = new();
        _statuses = new();
        IsActive = false;
        Changed?.Invoke();
    }
}

public sealed record DiffRefresh(IReadOnlyList<FunctionDiff> Diffs, IReadOnlyList<ChangeCard> Cards);

/// <summary>
/// The Diff toggle (refreshDiffs + useDiffToggle + useAcceptDiff): fetches the diffs and change cards together, reveals each
/// changed block, publishes both layers at once, restores the pre-diff expansion when turned off or cancelled, coalesces live
/// refreshes into the run in flight plus one trailing rerun, and commits a node on Accept.
/// </summary>
public sealed class DiffController
{
    private static readonly HashSet<string> ContainerLevels = ["system", "pillar", "component", "file", "folder"];

    private readonly IDiffBridge _bridge;
    private readonly IHierarchySource _source;
    private readonly ExpansionState _expansion;
    private CancellationTokenSource? _activation;
    private ExpansionState.Snapshot? _preDiff;
    private bool _running, _rerunQueued;
    private int _epoch;

    public DiffController(IDiffBridge bridge, IHierarchySource source, ExpansionState expansion, DiffOverlay overlay)
    {
        _bridge = bridge;
        _source = source;
        _expansion = expansion;
        Overlay = overlay;
    }

    public DiffOverlay Overlay { get; }
    public event Action? PendingChanged;

    /// <summary>From the click until the fetch and reveal settle; a click while pending cancels.</summary>
    public bool IsPending { get; private set; }
    public string? LastError { get; private set; }
    public bool IsAccepting { get; private set; }
    public string? AcceptError { get; private set; }
    /// <summary>The refresh an Accept kicked off, for callers that want to wait for it (the commit itself never waits).</summary>
    public Task PendingRefresh { get; private set; } = Task.CompletedTask;

    public async Task ToggleAsync()
    {
        if (IsPending) { Cancel(); return; }
        if (Overlay.IsActive) { Deactivate(); return; }
        _preDiff = _expansion.TakeSnapshot();
        var run = _activation = new CancellationTokenSource();
        SetPending(true);
        LastError = null;
        try
        {
            if (await RefreshAsync(run.Token) is null) return;
        }
        catch (Exception ex)
        {
            if (ReferenceEquals(_activation, run))
            {
                LastError = ex.Message;
                _expansion.Restore(_preDiff);
            }
        }
        finally
        {
            if (ReferenceEquals(_activation, run)) SetPending(false);
        }
    }

    private void Cancel()
    {
        _epoch++;
        _activation?.Cancel();
        _activation = null;
        if (_preDiff is not null) _expansion.Restore(_preDiff);
        SetPending(false);
    }

    private void Deactivate()
    {
        _epoch++;
        if (_preDiff is not null) _expansion.Restore(_preDiff);
        _preDiff = null;
        Overlay.Clear();
    }

    private void SetPending(bool value)
    {
        IsPending = value;
        PendingChanged?.Invoke();
    }

    /// <summary>Fetches, reveals and publishes; resolves to null when cancelled, never rejecting on an abort.</summary>
    public async Task<DiffRefresh?> RefreshAsync(CancellationToken ct = default)
    {
        var epoch = _epoch;
        IReadOnlyList<FunctionDiff> entries;
        ChangeCardSet? cardSet;
        try
        {
            var diffTask = _bridge.GetDiffAsync(ct);
            var cardTask = SafeCardsAsync(ct);
            entries = await diffTask;
            cardSet = await cardTask;
        }
        catch (OperationCanceledException)
        {
            return null;
        }
        if (ct.IsCancellationRequested || epoch != _epoch) return null;
        var diffed = entries.Select(e => e.NodeId).ToHashSet();
        var cards = (cardSet?.Cards ?? new List<ChangeCard>()).Where(c => !diffed.Contains(c.NodeId)).ToList();
        foreach (var entry in entries.Where(e => e.Status != "deleted" && e.Level != "file"))
        {
            RevealAncestors(entry.NodeId);
            RevealEntry(entry);
        }
        foreach (var nodeId in cards.Select(c => c.NodeId).Distinct()) RevealAncestors(nodeId);
        if (ct.IsCancellationRequested || epoch != _epoch) return null;
        Overlay.Publish(entries, cards, cardSet?.ByNodeStatus);
        return new DiffRefresh(entries, cards);
    }

    private async Task<ChangeCardSet?> SafeCardsAsync(CancellationToken ct)
    {
        try { return await _bridge.GetChangeCardsAsync(ct); }
        catch (OperationCanceledException) { throw; }
        catch (Exception) { return null; }
    }

    private void RevealAncestors(string nodeId)
    {
        var chain = new List<string>();
        for (var cur = _source.Get(nodeId)?.ParentId; cur is not null && cur != HierarchyIds.Root && chain.Count < 64; cur = _source.Get(cur)?.ParentId) chain.Insert(0, cur);
        foreach (var id in chain) _expansion.Expand(id);
    }

    /// <summary>A container is opened so its children keep their own boxes; a class or function shows its source (or diff) directly.</summary>
    private void RevealEntry(FunctionDiff entry)
    {
        var level = _source.Get(entry.NodeId)?.Level ?? entry.Level;
        if (level is not null && ContainerLevels.Contains(level) || entry.Level is "file" or "folder") _expansion.Expand(entry.NodeId);
        else _expansion.ShowCode(entry.NodeId);
    }

    /// <summary>Live path: a refresh during a run queues one trailing rerun instead of cancelling, so the last one always publishes.</summary>
    public Task ScheduleRefreshAsync()
    {
        if (_running)
        {
            _rerunQueued = true;
            return Task.CompletedTask;
        }
        _running = true;
        return RunScheduledAsync();
    }

    private async Task RunScheduledAsync()
    {
        try
        {
            do
            {
                _rerunQueued = false;
                try { await RefreshAsync(); }
                catch (Exception ex) { LastError = ex.Message; }
            } while (_rerunQueued);
        }
        finally
        {
            _running = false;
        }
    }

    /// <summary>Commits one diffed node; on success its inline view closes and a refresh follows (not awaited by the caller).</summary>
    public async Task<bool> AcceptAsync(string nodeId)
    {
        IsAccepting = true;
        AcceptError = null;
        try
        {
            await _bridge.AcceptAsync(nodeId, CancellationToken.None);
        }
        catch (Exception ex)
        {
            AcceptError = string.IsNullOrEmpty(ex.Message) ? "accept failed" : ex.Message;
            return false;
        }
        finally
        {
            IsAccepting = false;
        }
        PendingRefresh = ScheduleRefreshAsync();
        _expansion.HideCode(nodeId);
        return true;
    }
}
