namespace CodeChroma.Canvas.Connectors;

/// <summary>The two boxes an item joins, plus optional stable ids so port grouping survives subpixel rect drift.</summary>
public sealed record RoutedEndpoints(Rect From, Rect To, string? FromId = null, string? ToId = null);

/// <summary>One edge routed around the diagram's boxes, paired with the input item it was routed for.</summary>
public sealed record RoutedEdge<T>(T Item, Route Route);

/// <summary>
/// The lanes, ports, router, map idiom every connection layer repeats (port of routeEdges.ts): lanes are assigned
/// across every item, arrow endpoints are spread over their exact box+side in one pool (an exit and an enter on one
/// side count against each other), then one obstacle-aware router routes them in input order.
/// </summary>
public static class EdgeRouter
{
    private sealed record PortEndpoint(string Key, double Sort, int EdgeIndex, bool IsFrom);

    public static IReadOnlyList<RoutedEdge<T>> Route<T>(
        IReadOnlyList<T> items, Func<T, string> keyOf, Func<T, RoutedEndpoints?> endpointsOf, IReadOnlyList<Rect> obstacles)
    {
        var lanes = OrthogonalRoute.AssignLanes(items, keyOf);
        var ends = items.Select(endpointsOf).ToList();

        var ports = new List<PortEndpoint>();
        for (var index = 0; index < ends.Count; index++)
        {
            var endpoint = ends[index];
            if (endpoint is null) continue;
            var (fromSide, toSide) = OrthogonalRoute.ChooseSides(endpoint.From, endpoint.To);
            ports.Add(MakePort(endpoint.From, fromSide, endpoint.To, index, true, endpoint.FromId));
            ports.Add(MakePort(endpoint.To, toSide, endpoint.From, index, false, endpoint.ToId));
        }
        var (fromPorts, toPorts) = DisplacePorts(ports, items.Count);

        var router = new ObstacleRouter(obstacles);
        var routed = new List<RoutedEdge<T>>();
        for (var index = 0; index < items.Count; index++)
        {
            var endpoint = ends[index];
            if (endpoint is null) continue;
            routed.Add(new RoutedEdge<T>(items[index], router.Route(endpoint.From, endpoint.To, lanes[index], fromPorts[index], toPorts[index])));
        }
        return routed;
    }

    private static PortEndpoint MakePort(Rect rect, Side side, Rect far, int edgeIndex, bool isFrom, string? id)
    {
        var key = id is not null ? $"{id}|{SideName(side)}" : $"{OrthogonalRoute.RectKeyOf(rect)}|{SideName(side)}";
        return new PortEndpoint(key, AxisCentre(far, side), edgeIndex, isFrom);
    }

    private static string SideName(Side side) => side.ToString().ToLowerInvariant();

    private static double AxisCentre(Rect far, Side side) => side is Side.Left or Side.Right ? far.Top + far.Height / 2 : far.Left + far.Width / 2;

    private static (double[] From, double[] To) DisplacePorts(IReadOnlyList<PortEndpoint> endpoints, int count)
    {
        var sorted = endpoints
            .Select((e, i) => (Endpoint: e, Order: i))
            .OrderBy(x => x.Endpoint.Key, StringComparer.Ordinal)
            .ThenBy(x => x.Endpoint.Sort)
            .ThenBy(x => x.Order)
            .Select(x => x.Endpoint)
            .ToList();
        var offsets = OrthogonalRoute.AssignPorts(sorted.Select(e => e.Key).ToList(), Connector.PortGap);
        var from = new double[count];
        var to = new double[count];
        for (var index = 0; index < sorted.Count; index++)
        {
            if (sorted[index].IsFrom) from[sorted[index].EdgeIndex] = offsets[index];
            else to[sorted[index].EdgeIndex] = offsets[index];
        }
        return (from, to);
    }
}
