namespace CodeChroma.Canvas.Layout;

public sealed record AutoLayoutResult(IReadOnlyDictionary<string, Position> Positions, IReadOnlyDictionary<string, Size>? Sizes);

/// <summary>
/// Positions brand-new elements (port of autoLayout.ts) with one layered-layout pass over just that subgraph, shifted
/// below whatever is already on the document. Existing elements never move: only the new ids are positioned. A layer that
/// already has placed boxes is updated incrementally; epics and sequence layers take their deterministic layouts.
/// </summary>
public static class AutoLayout
{
    private const double DefaultWidth = 300, DefaultHeight = 72, NewElementsMargin = 80;

    /// <summary>Same constants the sequence renderer uses; colW is wider than headW so adjacent heads keep a gap.</summary>
    public static class SequenceMetrics
    {
        public const double ColW = 260, HeadH = 36, HeadW = 180, RowH = 58, HeadGap = 26;
    }

    public static AutoLayoutResult LayoutNewElements(CanvasDoc doc, IReadOnlyList<string> newIds, IReadOnlyDictionary<string, Position>? fixedPositions = null)
    {
        fixedPositions ??= new Dictionary<string, Position>();
        var newSet = newIds.ToHashSet();
        var sequenceIds = newIds.Where(id => doc.Elements.TryGetValue(id, out var e) && e.Render == RenderKind.Sequence).ToList();
        var nonSequenceIds = newIds.Where(id => !sequenceIds.Contains(id)).ToList();
        var sequence = LayoutSequence(doc, sequenceIds);

        static (double W, double H) SizeOf(CanvasElement e) => (e.Size?.W ?? DefaultWidth, e.Size?.H ?? DefaultHeight);
        LayoutBoxSpec SpecOf(CanvasElement e) =>
            new(e.Id, SizeOf(e).W, SizeOf(e).H, ElementMeta.String(e, "order"), ElementMeta.String(e, "lane"));

        var nodes = nonSequenceIds.Where(doc.Elements.ContainsKey).Select(id => SpecOf(doc.Elements[id])).ToList();
        var existing = doc.Elements.Values.Where(e => !newSet.Contains(e.Id)).ToList();
        var yOffset = existing.Count > 0 ? existing.Max(e => e.Position.Y + SizeOf(e).H / 2) + NewElementsMargin : 0;

        if (EpicsLayout.IsEpicsLayer(doc, newIds))
        {
            var epics = EpicsLayout.Layout(doc, newIds);
            var shifted = epics.Positions.ToDictionary(kv => kv.Key, kv => new Position(kv.Value.X, kv.Value.Y + yOffset));
            foreach (var (id, p) in sequence.Positions) shifted[id] = p;
            return new AutoLayoutResult(shifted, epics.Sizes);
        }

        var layers = nonSequenceIds.Where(doc.Elements.ContainsKey).Select(id => doc.Elements[id].Layer).ToHashSet();
        var pinnedElements = doc.Elements.Values
            .Where(e => layers.Contains(e.Layer) && !newSet.Contains(e.Id) && e.Render is not (RenderKind.Group or RenderKind.Note or RenderKind.Sequence))
            .ToList();
        if (nodes.Count > 0 && pinnedElements.Count > 0)
        {
            Position Where(CanvasElement e) => fixedPositions.TryGetValue(e.Id, out var p) ? p : e.Position;
            var pinned = pinnedElements.Select(e => new PinnedBox(SpecOf(e), Where(e))).ToList();
            var pinnedIds = pinned.Select(p => p.Spec.Id).ToHashSet();
            var inGraph = pinnedIds.Concat(nodes.Select(n => n.Id)).ToHashSet();
            var obstacles = existing
                .Where(e => !pinnedIds.Contains(e.Id) && e.Render != RenderKind.Group)
                .Select(e =>
                {
                    var (w, h) = SizeOf(e);
                    var c = Where(e);
                    return new Obstacle(e.Id, new Box(c.X - w / 2, c.Y - h / 2, w, h));
                }).ToList();
            var incrementalEdges = doc.Edges.Values
                .Where(e => inGraph.Contains(e.From) && inGraph.Contains(e.To))
                .Select(e => new LayoutEdge(e.From, e.To, e.Kind)).ToList();
            var placed = IncrementalLayout.Place(pinned, nodes, incrementalEdges, obstacles);
            var merged = new Dictionary<string, Position>(placed);
            foreach (var (id, p) in sequence.Positions) merged[id] = p;
            return new AutoLayoutResult(merged, sequence.Sizes);
        }

        var newEdges = doc.Edges.Values
            .Where(e => newSet.Contains(e.From) && newSet.Contains(e.To))
            .Select(e => new LayoutEdge(e.From, e.To, e.Kind)).ToList();
        var layout = LayeredLayout.Compute(nodes, newEdges);
        var positions = layout.Boxes.ToDictionary(b => b.Id, b => new Position(b.X, b.Y + yOffset));
        foreach (var (id, p) in sequence.Positions) positions[id] = p;
        return new AutoLayoutResult(positions, sequence.Sizes);
    }

    /// <summary>Deterministic columns (participants) and time rows (messages) derived from meta, never a graph layout.</summary>
    public static AutoLayoutResult LayoutSequence(CanvasDoc doc, IReadOnlyList<string> ids)
    {
        var positions = new Dictionary<string, Position>();
        var sizes = new Dictionary<string, Size>();
        if (ids.Count == 0) return new AutoLayoutResult(positions, sizes);

        var elements = ids.Where(doc.Elements.ContainsKey).Select(id => doc.Elements[id]).ToList();
        var participants = elements.Where(e => ElementMeta.String(e, "role") == "participant").ToList();
        var colByRef = new Dictionary<string, int>();
        for (var i = 0; i < participants.Count; i++)
        {
            colByRef[participants[i].Id] = i;
            if (ElementMeta.String(participants[i], "recipe_key") is { } key) colByRef[key] = i;
            positions[participants[i].Id] = new Position(i * SequenceMetrics.ColW + SequenceMetrics.ColW / 2, SequenceMetrics.HeadH);
            sizes[participants[i].Id] = new Size(SequenceMetrics.HeadW, SequenceMetrics.HeadH);
        }
        foreach (var element in elements.Where(e => ElementMeta.String(e, "role") == "message"))
        {
            var order = ElementMeta.Raw(element, "order") switch
            {
                double d => d,
                string s when double.TryParse(s, System.Globalization.CultureInfo.InvariantCulture, out var d) => d,
                _ => double.NaN,
            };
            var from = ElementMeta.Raw(element, "from")?.ToString() ?? "";
            var to = ElementMeta.Raw(element, "to")?.ToString() ?? "";
            if (double.IsNaN(order) || !colByRef.TryGetValue(from, out var x1) || !colByRef.TryGetValue(to, out var x2)) continue;
            var y = SequenceMetrics.HeadH + SequenceMetrics.HeadGap + SequenceMetrics.RowH * (order - 1) + SequenceMetrics.RowH / 2;
            var xMid = (x1 * SequenceMetrics.ColW + x2 * SequenceMetrics.ColW) / 2 + SequenceMetrics.ColW / 2;
            positions[element.Id] = new Position(xMid, y);
            sizes[element.Id] = new Size(Math.Max(Math.Abs(x1 - x2) * SequenceMetrics.ColW, 40), SequenceMetrics.RowH);
        }
        return new AutoLayoutResult(positions, sizes);
    }
}
