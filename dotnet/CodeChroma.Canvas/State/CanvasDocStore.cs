namespace CodeChroma.Canvas.State;

public sealed record BatchResult(bool Ok, IReadOnlyList<string> ErrorMessages);

public sealed record RecipeRunResult(bool Ok, IReadOnlyDictionary<string, string> IdMap, IReadOnlyList<string> Errors);

/// <summary>The canvas endpoints the logic needs; the real client is Plan 2's REST contract, tests use a fake.</summary>
public interface ICanvasBridge
{
    Task<CanvasDoc> GetCanvasAsync();
    Task<BatchResult> PatchCanvasAsync(CanvasBatch batch);
    Task<RecipeRunResult> RunRecipeAsync(string name);
    Task<bool> DeleteDiagramAsync(string kind);
}

public sealed record PatchOptions(string? Layer = null, string? Explanation = null, bool ConfirmMassDelete = false);

/// <summary>
/// The one canvas document in memory plus the optimistic edit a drag needs (port of canvasDocStore.ts). Every fetch gets a
/// sequence number so the newest response always wins, and a layer mid auto-layout is withheld while its recipe commit is
/// still piled on the origin, so the pile never flashes.
/// </summary>
public sealed class CanvasDocStore
{
    private CanvasDoc _doc = CanvasDoc.Empty;
    private readonly List<string> _deferred = new();
    private int _latestFetchSeq;

    public event Action? Changed;

    public CanvasDoc Doc => _doc;
    public bool Loaded { get; private set; }

    /// <summary>Layers whose auto-layout failed once; skipped afterwards so a persistent failure cannot loop.</summary>
    public ISet<string> UnlayoutableLayers { get; } = new HashSet<string>();

    /// <summary>Ids the auto-layout already placed, so a box that lands back on the origin is not re-placed.</summary>
    public ISet<string> AutoPlacedIds { get; } = new HashSet<string>();

    public void SetDoc(CanvasDoc doc)
    {
        _doc = doc;
        Loaded = true;
        Changed?.Invoke();
    }

    public void DeferLayout(string layer)
    {
        if (!_deferred.Contains(layer)) _deferred.Add(layer);
    }

    public void ReleaseLayout(string layer) => _deferred.Remove(layer);

    public IReadOnlyList<string> LayersMidLayout() => _deferred.ToList();

    /// <summary>Merges positions straight into local state in one change notification.</summary>
    public void MoveElements(IReadOnlyDictionary<string, Position> positions)
    {
        var elements = new Dictionary<string, CanvasElement>(_doc.Elements);
        var changed = false;
        foreach (var (id, position) in positions)
        {
            if (!elements.TryGetValue(id, out var element)) continue;
            elements[id] = element with { Position = position };
            changed = true;
        }
        if (!changed) return;
        _doc = _doc with { Elements = elements };
        Changed?.Invoke();
    }

    /// <summary>Fetches the canvas and applies it only if no newer fetch was issued and the caller is still alive.</summary>
    public async Task FetchAndApplyAsync(ICanvasBridge bridge, Func<bool>? isStale = null)
    {
        isStale ??= () => false;
        var seq = ++_latestFetchSeq;
        var doc = await bridge.GetCanvasAsync();

        var transientPile = _deferred.Any(layer =>
        {
            var members = doc.Elements.Values.Where(e => e.Layer == layer).ToList();
            return members.Count > 0 && members.All(e => e.Position.X == 0 && e.Position.Y == 0);
        });
        if (transientPile) return;

        var skip = UnlayoutableLayers.Concat(_deferred).ToHashSet();
        var unplaced = PileLayout.FindUnplaced(doc, skip, AutoPlacedIds);
        var laidOut = false;
        foreach (var (layer, ids) in unplaced)
        {
            DeferLayout(layer);
            foreach (var id in ids) AutoPlacedIds.Add(id);
            try
            {
                laidOut |= await LayoutUnplacedAsync(bridge, doc, layer, ids).WaitAsync(LayoutTimeout);
            }
            catch (Exception)
            {
                UnlayoutableLayers.Add(layer);
            }
            finally
            {
                ReleaseLayout(layer);
            }
        }
        if (laidOut)
        {
            await FetchAndApplyAsync(bridge, isStale);
            return;
        }
        if (seq == _latestFetchSeq && !isStale()) SetDoc(doc);
    }

    /// <summary>How long an auto-layout PATCH may hold its layer back before the layer is treated as unlayoutable.</summary>
    public TimeSpan LayoutTimeout { get; set; } = TimeSpan.FromSeconds(15);

    private static async Task<bool> LayoutUnplacedAsync(ICanvasBridge bridge, CanvasDoc doc, string layer, IReadOnlyList<string> ids)
    {
        var result = AutoLayout.LayoutNewElements(doc, ids);
        var ops = PileLayout.LayoutOps(result.Positions, result.Sizes);
        if (ops.Count == 0) return false;
        var batch = await bridge.PatchCanvasAsync(new CanvasBatch(ops, layer, "auto-layout unplaced boxes", false));
        if (!batch.Ok) throw new InvalidOperationException(batch.ErrorMessages.FirstOrDefault() ?? "auto-layout rejected");
        return true;
    }

    /// <summary>Applies one batch, then refetches on success so every consumer sees the server's real state.</summary>
    public async Task<BatchResult> PatchAsync(ICanvasBridge bridge, IReadOnlyList<CanvasOp> ops, PatchOptions? options = null)
    {
        var result = await bridge.PatchCanvasAsync(new CanvasBatch(ops, options?.Layer ?? "default", options?.Explanation ?? "", options?.ConfirmMassDelete ?? false));
        if (result.Ok) await FetchAndApplyAsync(bridge);
        return result;
    }

    /// <summary>Settles positions optimistically and persists one update per id; rolls back only when the write itself fails or throws, and returns whether it landed.</summary>
    public async Task<bool> ApplyCanvasPositionsAsync(ICanvasBridge bridge, IReadOnlyDictionary<string, Position> positions)
    {
        var prior = positions.Keys.Where(_doc.Elements.ContainsKey).ToDictionary(id => id, id => _doc.Elements[id].Position);
        MoveElements(positions);
        try
        {
            var ops = positions.Select(kv => new CanvasOp("update_element", kv.Key, kv.Value)).ToList();
            var result = await bridge.PatchCanvasAsync(new CanvasBatch(ops, "default", "", false));
            if (!result.Ok)
            {
                MoveElements(prior);
                return false;
            }
        }
        catch (Exception)
        {
            MoveElements(prior);
            return false;
        }
        try
        {
            await FetchAndApplyAsync(bridge);
        }
        catch (Exception)
        {
            // the write landed; a failed refetch keeps the optimistic positions until the next ping
        }
        return true;
    }
}
