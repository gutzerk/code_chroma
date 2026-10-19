namespace CodeChroma.Canvas.Layout;

public static class PileLayout
{
    private const string NeverPiledLayer = "hierarchy";

    /// <summary>
    /// Per layer, the boxes still on the origin. A whole layer on the origin is a pile to lay out from scratch; some
    /// are new boxes to slot in. A layer needs two or more boxes, ids in <paramref name="done"/> never re-trigger,
    /// and a locked-layout layer is only ever laid out whole.
    /// </summary>
    public static IReadOnlyDictionary<string, IReadOnlyList<string>> FindUnplaced(CanvasDoc doc, ISet<string> skipLayers, ISet<string> done)
    {
        var byLayer = new Dictionary<string, List<CanvasElement>>();
        var order = new List<string>();
        foreach (var element in doc.Elements.Values)
        {
            if (element.Layer == NeverPiledLayer || skipLayers.Contains(element.Layer)) continue;
            if (!byLayer.TryGetValue(element.Layer, out var list)) { byLayer[element.Layer] = list = new List<CanvasElement>(); order.Add(element.Layer); }
            list.Add(element);
        }
        var unplaced = new Dictionary<string, IReadOnlyList<string>>();
        foreach (var layer in order)
        {
            var elements = byLayer[layer];
            if (elements.Count < 2) continue;
            var orphans = elements.Where(e => e.Position.X == 0 && e.Position.Y == 0 && !done.Contains(e.Id)).ToList();
            var whole = orphans.Count == elements.Count;
            var locked = elements.Any(e => ElementRules.For(e.Render).LockedLayout || e.Render == RenderKind.Group);
            if (orphans.Count > 0 && (whole || !locked)) unplaced[layer] = orphans.Select(e => e.Id).ToList();
        }
        return unplaced;
    }

    /// <summary>The update_element ops that persist a layout's positions (and any derived sizes).</summary>
    public static IReadOnlyList<CanvasOp> LayoutOps(IReadOnlyDictionary<string, Position> positions, IReadOnlyDictionary<string, Size>? sizes = null) =>
        positions.Select(kv => new CanvasOp("update_element", kv.Key, kv.Value, sizes is not null && sizes.TryGetValue(kv.Key, out var s) ? s : null)).ToList();
}
