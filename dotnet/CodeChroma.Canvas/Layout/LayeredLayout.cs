namespace CodeChroma.Canvas.Layout;

public sealed record LayoutBoxSpec(string Id, double Width, double Height, string? Order = null, string? Lane = null);

public sealed record LayoutEdge(string From, string To, string? Kind = null);

/// <summary>A laid-out box, X and Y being the box CENTRE.</summary>
public sealed record PositionedBox(string Id, double X, double Y, double Width, double Height);

public sealed record LayoutResult(IReadOnlyList<PositionedBox> Boxes, double Width, double Height);

/// <summary>
/// The native layered (Sugiyama-style) layout that replaces elkjs: cycle breaking by DFS, longest-path layers,
/// barycentre ordering, lane clustering, per-component layout and row packing toward an aspect ratio of 1.6. Authored
/// <c>order</c> is authoritative (an edge against it is dropped and consecutive orders are chained). Deterministic: every
/// tie breaks on input order.
/// </summary>
public static class LayeredLayout
{
    private const double Margin = 40;
    private const double AspectRatio = 1.6;

    public static LayoutResult Compute(IReadOnlyList<LayoutBoxSpec> nodes, IReadOnlyList<LayoutEdge> edges, Action<string>? warn = null)
    {
        if (nodes.Count == 0) return new LayoutResult(Array.Empty<PositionedBox>(), 600, 400);

        var ids = nodes.Select(n => n.Id).ToHashSet();
        var seen = new HashSet<(string, string)>();
        var kept = ApplyOrder(nodes, edges, warn)
            .Where(e => ids.Contains(e.From) && ids.Contains(e.To) && e.From != e.To)
            .Where(e => seen.Add((e.From, e.To)))
            .ToList();

        var ordered = ClusterByLane(nodes);
        var index = ordered.Select((n, i) => (n.Id, i)).ToDictionary(x => x.Id, x => x.i);
        var components = Components(ordered, kept);

        var laidOut = components.Select(c => LayoutComponent(c, kept, index)).ToList();
        var area = laidOut.Sum(c => (c.Width + CollisionConstants.ElkNodeSep) * (c.Height + CollisionConstants.ElkNodeSep));
        var target = Math.Max(laidOut.Max(c => c.Width), Math.Sqrt(AspectRatio * area));

        var placed = new Dictionary<string, PositionedBox>();
        double x = 0, y = 0, rowHeight = 0, maxRight = 0;
        foreach (var component in laidOut)
        {
            if (x > 0 && x + component.Width > target)
            {
                x = 0;
                y += rowHeight + CollisionConstants.ElkNodeSep;
                rowHeight = 0;
            }
            foreach (var box in component.Boxes)
                placed[box.Id] = box with { X = box.X + x + Margin, Y = box.Y + y + Margin };
            maxRight = Math.Max(maxRight, x + component.Width);
            rowHeight = Math.Max(rowHeight, component.Height);
            x += component.Width + CollisionConstants.ElkNodeSep;
        }
        var bottom = y + rowHeight;
        return new LayoutResult(nodes.Select(n => placed[n.Id]).ToList(), maxRight + Margin * 2, bottom + Margin * 2);
    }

    private sealed record ComponentLayout(IReadOnlyList<PositionedBox> Boxes, double Width, double Height);

    private static int? ParseOrderRank(string? order, Action<string>? warn)
    {
        var digits = ElementMeta.LeadingOrderDigits(order);
        if (digits is null) return null;
        var rank = int.Parse(digits) - 1;
        if (rank < 0) warn?.Invoke($"meta.order \"{order}\" is out of range (Order is 1-indexed) -- treating as \"1\"");
        return Math.Max(0, rank);
    }

    private static List<LayoutEdge> ApplyOrder(IReadOnlyList<LayoutBoxSpec> nodes, IReadOnlyList<LayoutEdge> edges, Action<string>? warn)
    {
        var rankOf = new Dictionary<string, int>();
        foreach (var node in nodes)
            if (ParseOrderRank(node.Order, warn) is { } rank) rankOf[node.Id] = rank;
        var keptEdges = edges.Where(e =>
        {
            var from = rankOf.TryGetValue(e.From, out var f) ? f : (int?)null;
            var to = rankOf.TryGetValue(e.To, out var t) ? t : (int?)null;
            return from is null || to is null || from <= to;
        }).ToList();
        var byRank = new SortedDictionary<int, List<string>>();
        foreach (var (id, rank) in rankOf)
        {
            if (!byRank.TryGetValue(rank, out var list)) byRank[rank] = list = new List<string>();
            list.Add(id);
        }
        var ranks = byRank.Keys.ToList();
        for (var i = 1; i < ranks.Count; i++)
            foreach (var from in byRank[ranks[i - 1]])
                foreach (var to in byRank[ranks[i]])
                    keptEdges.Add(new LayoutEdge(from, to));
        return keptEdges;
    }

    private static List<LayoutBoxSpec> ClusterByLane(IReadOnlyList<LayoutBoxSpec> nodes)
    {
        var firstOfLane = new Dictionary<string, int>();
        for (var i = 0; i < nodes.Count; i++)
            if (nodes[i].Lane is { Length: > 0 } lane && !firstOfLane.ContainsKey(lane)) firstOfLane[lane] = i;
        return nodes
            .Select((n, i) => (Node: n, Index: i, Cluster: n.Lane is not null && firstOfLane.TryGetValue(n.Lane, out var f) ? f : i))
            .OrderBy(x => x.Cluster).ThenBy(x => x.Index)
            .Select(x => x.Node).ToList();
    }

    private static List<List<LayoutBoxSpec>> Components(IReadOnlyList<LayoutBoxSpec> ordered, IReadOnlyList<LayoutEdge> edges)
    {
        var parent = ordered.ToDictionary(n => n.Id, n => n.Id);
        string Find(string id) { while (parent[id] != id) { parent[id] = parent[parent[id]]; id = parent[id]; } return id; }
        foreach (var e in edges) parent[Find(e.From)] = Find(e.To);
        var groups = new Dictionary<string, List<LayoutBoxSpec>>();
        var rootOrder = new List<string>();
        foreach (var n in ordered)
        {
            var root = Find(n.Id);
            if (!groups.TryGetValue(root, out var list)) { groups[root] = list = new List<LayoutBoxSpec>(); rootOrder.Add(root); }
            list.Add(n);
        }
        return rootOrder.Select(r => groups[r]).ToList();
    }

    private static ComponentLayout LayoutComponent(List<LayoutBoxSpec> nodes, IReadOnlyList<LayoutEdge> allEdges, Dictionary<string, int> index)
    {
        var ids = nodes.Select(n => n.Id).ToHashSet();
        var edges = allEdges.Where(e => ids.Contains(e.From) && ids.Contains(e.To)).ToList();

        // Break cycles: a DFS in input order marks back edges, which layering ignores.
        var outgoing = nodes.ToDictionary(n => n.Id, _ => new List<string>());
        foreach (var e in edges) outgoing[e.From].Add(e.To);
        var state = new Dictionary<string, int>();
        var back = new HashSet<(string, string)>();
        void Visit(string id)
        {
            state[id] = 1;
            foreach (var next in outgoing[id].OrderBy(n => index[n]))
            {
                if (!state.TryGetValue(next, out var s)) Visit(next);
                else if (s == 1) back.Add((id, next));
            }
            state[id] = 2;
        }
        foreach (var n in nodes) if (!state.ContainsKey(n.Id)) Visit(n.Id);
        var dag = edges.Where(e => !back.Contains((e.From, e.To))).ToList();

        // Longest-path layers over the DAG.
        var preds = nodes.ToDictionary(n => n.Id, _ => new List<string>());
        var succs = nodes.ToDictionary(n => n.Id, _ => new List<string>());
        foreach (var e in dag) { preds[e.To].Add(e.From); succs[e.From].Add(e.To); }
        var layerOf = new Dictionary<string, int>();
        int LayerOf(string id)
        {
            if (layerOf.TryGetValue(id, out var l)) return l;
            return layerOf[id] = preds[id].Count == 0 ? 0 : preds[id].Max(LayerOf) + 1;
        }
        foreach (var n in nodes) LayerOf(n.Id);

        var layerCount = layerOf.Values.Max() + 1;
        var layers = Enumerable.Range(0, layerCount).Select(_ => new List<LayoutBoxSpec>()).ToList();
        foreach (var n in nodes) layers[layerOf[n.Id]].Add(n);

        // Barycentre sweeps down and up; ties keep the previous order.
        for (var sweep = 0; sweep < 4; sweep++)
        {
            for (var i = 1; i < layerCount; i++) Reorder(layers[i], preds, layers[i - 1]);
            for (var i = layerCount - 2; i >= 0; i--) Reorder(layers[i], succs, layers[i + 1]);
        }
        for (var i = 0; i < layerCount; i++) layers[i] = RegroupLanes(layers[i]);

        var widths = layers.Select(l => l.Sum(n => n.Width) + CollisionConstants.ElkNodeSep * (l.Count - 1)).ToList();
        var width = widths.Max();
        var boxes = new List<PositionedBox>();
        double y = 0;
        for (var i = 0; i < layerCount; i++)
        {
            var height = layers[i].Max(n => n.Height);
            var x = (width - widths[i]) / 2;
            foreach (var n in layers[i])
            {
                boxes.Add(new PositionedBox(n.Id, x + n.Width / 2, y + height / 2, n.Width, n.Height));
                x += n.Width + CollisionConstants.ElkNodeSep;
            }
            y += height + CollisionConstants.ElkRankSep;
        }
        return new ComponentLayout(boxes, width, y - CollisionConstants.ElkRankSep);
    }

    private static void Reorder(List<LayoutBoxSpec> layer, Dictionary<string, List<string>> neighbours, List<LayoutBoxSpec> fixedLayer)
    {
        var pos = fixedLayer.Select((n, i) => (n.Id, i)).ToDictionary(x => x.Id, x => (double)x.i);
        var keyed = layer.Select((n, i) =>
        {
            var near = neighbours[n.Id].Where(pos.ContainsKey).Select(id => pos[id]).ToList();
            return (Node: n, Key: near.Count > 0 ? near.Average() : (double)i, Index: i);
        }).OrderBy(x => x.Key).ThenBy(x => x.Index).Select(x => x.Node).ToList();
        layer.Clear();
        layer.AddRange(keyed);
    }

    private static List<LayoutBoxSpec> RegroupLanes(List<LayoutBoxSpec> layer)
    {
        var firstOfLane = new Dictionary<string, int>();
        for (var i = 0; i < layer.Count; i++)
            if (layer[i].Lane is { Length: > 0 } lane && !firstOfLane.ContainsKey(lane)) firstOfLane[lane] = i;
        return layer
            .Select((n, i) => (Node: n, Index: i, Cluster: n.Lane is not null && firstOfLane.TryGetValue(n.Lane, out var f) ? f : i))
            .OrderBy(x => x.Cluster).ThenBy(x => x.Index)
            .Select(x => x.Node).ToList();
    }
}
