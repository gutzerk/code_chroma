namespace CodeChroma.Canvas.Catalog;

public sealed record OpResult(bool Ok, string? Error = null);

/// <summary>
/// The stateful diagram operations (runRecipeAndLayout, removeLayerAndRefresh, deleteDiagramAndRefresh): a recipe run lays
/// out only the elements it just added (or the whole layer for a hard-layout kind), restores positions a remove captured,
/// and withholds the transient origin pile while the layout is in flight.
/// </summary>
public sealed class DiagramOrchestrator
{
    private readonly ICanvasBridge _bridge;
    private readonly CanvasDocStore _store;
    private readonly LayerPositionCache _cache;
    private readonly DiagramHealthStore _health;

    public DiagramOrchestrator(ICanvasBridge bridge, CanvasDocStore store, LayerPositionCache cache, DiagramHealthStore health)
    {
        _bridge = bridge;
        _store = store;
        _cache = cache;
        _health = health;
    }

    public async Task<OpResult> RunRecipeAndLayoutAsync(string name)
    {
        _store.DeferLayout(name);
        try
        {
            var result = await _bridge.RunRecipeAsync(name);
            if (!result.Ok) return new OpResult(false, result.Errors.FirstOrDefault() ?? "recipe run failed");

            var doc = await _bridge.GetCanvasAsync();
            var newIds = result.IdMap.Values.Where(doc.Elements.ContainsKey).ToList();
            var hardLayout = newIds.Any(id => ElementRules.For(doc.Elements[id].Render).LockedLayout || doc.Elements[id].Render == RenderKind.Group);
            var layoutIds = hardLayout
                ? doc.Elements.Values.Where(e => e.Layer == name).Select(e => e.Id).ToList()
                : newIds;

            var restored = new Dictionary<string, Position>();
            var toLayout = new List<string>();
            foreach (var id in layoutIds)
            {
                var key = ElementMeta.String(doc.Elements[id], "recipe_key");
                var cached = key is null ? null : _cache.Take(name, key);
                if (cached is not null) restored[id] = cached;
                else toLayout.Add(id);
            }
            var layout = AutoLayout.LayoutNewElements(doc, toLayout, restored);
            var merged = new Dictionary<string, Position>(restored);
            foreach (var (id, p) in layout.Positions) merged[id] = p;
            var ops = PileLayout.LayoutOps(merged, layout.Sizes);
            if (ops.Count > 0)
                await _store.PatchAsync(_bridge, ops, new PatchOptions(Layer: name, Explanation: "auto-layout new elements"));
            return new OpResult(true);
        }
        finally
        {
            _store.ReleaseLayout(name);
        }
    }

    /// <summary>Deletes every element of the layer (plus stray edges), after snapshotting positions so a re-add restores them.</summary>
    public async Task<OpResult> RemoveLayerAndRefreshAsync(string layer)
    {
        var doc = _store.Doc;
        var layerElements = doc.Elements.Values.Where(e => e.Layer == layer).ToList();
        _cache.Capture(layerElements, layer);
        var deleting = layerElements.Select(e => e.Id).ToHashSet();
        var strayEdges = doc.Edges.Values.Where(e => e.Layer == layer && !deleting.Contains(e.From) && !deleting.Contains(e.To)).Select(e => e.Id);
        var ops = layerElements.Select(e => new CanvasOp("delete_element", e.Id))
            .Concat(strayEdges.Select(id => new CanvasOp("delete_edge", id))).ToList();
        _health.Clear(layer);
        if (ops.Count == 0) return new OpResult(true);
        var result = await _store.PatchAsync(_bridge, ops, new PatchOptions(Layer: layer, Explanation: "remove diagram", ConfirmMassDelete: true));
        return result.Ok ? new OpResult(true) : new OpResult(false, result.ErrorMessages.FirstOrDefault() ?? "remove failed");
    }

    /// <summary>File first, canvas second: a failed file delete leaves everything as it was, so a retry is safe.</summary>
    public async Task<OpResult> DeleteDiagramAndRefreshAsync(string layer)
    {
        if (DiagramCatalog.HasDeletableDiagramArtifact(layer))
        {
            try { await _bridge.DeleteDiagramAsync(layer); }
            catch (Exception ex) { return new OpResult(false, ex.Message); }
        }
        return await RemoveLayerAndRefreshAsync(layer);
    }
}
