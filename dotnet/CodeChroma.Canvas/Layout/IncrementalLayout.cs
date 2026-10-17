namespace CodeChroma.Canvas.Layout;

/// <summary>A box already on the canvas: its layout spec plus where it sits now (centre), wherever the user dragged it.</summary>
public sealed record PinnedBox(LayoutBoxSpec Spec, Position Position);

/// <summary>
/// Places only the added boxes (port of incrementalLayout.ts): the layered layout runs over pinned plus added together,
/// then each added box takes the offset (saved minus computed) of the pinned boxes it connects to, so it follows a
/// diagram the user moved or rearranged, and finally is nudged clear of everything with the drop solver.
/// </summary>
public static class IncrementalLayout
{
    public static IReadOnlyDictionary<string, Position> Place(
        IReadOnlyList<PinnedBox> pinned, IReadOnlyList<LayoutBoxSpec> added, IReadOnlyList<LayoutEdge> edges, IReadOnlyList<Obstacle> obstacles)
    {
        var layout = LayeredLayout.Compute(pinned.Select(p => p.Spec).Concat(added).ToList(), edges);
        var computed = layout.Boxes.ToDictionary(b => b.Id, b => (b.X, b.Y));

        var offsetOf = pinned.ToDictionary(p => p.Spec.Id, p => (X: p.Position.X - computed[p.Spec.Id].X, Y: p.Position.Y - computed[p.Spec.Id].Y));
        var globalOffset = (X: Median(offsetOf.Values.Select(o => o.X)), Y: Median(offsetOf.Values.Select(o => o.Y)));

        var neighbours = new Dictionary<string, List<string>>();
        foreach (var edge in edges)
            foreach (var (self, other) in new[] { (edge.From, edge.To), (edge.To, edge.From) })
                if (offsetOf.ContainsKey(other))
                {
                    if (!neighbours.TryGetValue(self, out var list)) neighbours[self] = list = new List<string>();
                    list.Add(other);
                }

        var placedObstacles = obstacles.Concat(pinned.Select(p => new Obstacle(p.Spec.Id,
            new Box(p.Position.X - p.Spec.Width / 2, p.Position.Y - p.Spec.Height / 2, p.Spec.Width, p.Spec.Height)))).ToList();
        var positions = new Dictionary<string, Position>();
        var ordered = added.OrderBy(b => computed[b.Id].Y).ThenBy(b => computed[b.Id].X).ThenBy(b => b.Id, StringComparer.Ordinal);
        foreach (var box in ordered)
        {
            var elk = computed[box.Id];
            var anchors = neighbours.TryGetValue(box.Id, out var n) ? n.Select(id => offsetOf[id]).ToList() : new();
            var offset = anchors.Count > 0 ? (X: anchors.Average(o => o.X), Y: anchors.Average(o => o.Y)) : globalOffset;
            var moving = new Box(elk.X + offset.X - box.Width / 2, elk.Y + offset.Y - box.Height / 2, box.Width, box.Height);
            var result = DropResolver.Resolve(moving, placedObstacles);
            positions[box.Id] = new Position(result.X + box.Width / 2, result.Y + box.Height / 2);
            placedObstacles.Add(new Obstacle(box.Id, moving with { X = result.X, Y = result.Y }));
        }
        return positions;
    }

    private static double Median(IEnumerable<double> values)
    {
        var sorted = values.OrderBy(v => v).ToList();
        if (sorted.Count == 0) return 0;
        var mid = sorted.Count / 2;
        return sorted.Count % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
}
