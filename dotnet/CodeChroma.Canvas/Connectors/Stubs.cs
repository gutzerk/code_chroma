namespace CodeChroma.Canvas.Connectors;

public static class Connector
{
    public const double Stub = 18, LaneGap = 14, PortGap = 26, Corner = 8, SidePad = 8;
}

public sealed record Lane(double Offset, int Rank);

public sealed record Route(string D, Point Label, IReadOnlyList<Point> Points);

public static class OrthogonalRoute
{
    public static Rect RectFromBox(double x, double y, double width, double height) => throw new NotImplementedException();
    public static string PairKeyOf(string a, string b) => throw new NotImplementedException();
    public static string RectKeyOf(Rect rect) => throw new NotImplementedException();
    public static IReadOnlyList<Lane> AssignLanes<T>(IReadOnlyList<T> items, Func<T, string> keyOf, double gap = Connector.LaneGap) => throw new NotImplementedException();
    public static IReadOnlyList<double> AssignPorts(IReadOnlyList<string> keys, double gap = Connector.PortGap) => throw new NotImplementedException();
    public static (Side From, Side To) ChooseSides(Rect from, Rect to) => throw new NotImplementedException();
    public static Point AnchorOf(Rect rect, Side side, double laneOffset = 0) => throw new NotImplementedException();
    public static Point StubPointOf(Point anchor, Side side) => throw new NotImplementedException();
    public static IReadOnlyList<Point> Simplify(IReadOnlyList<Point> points) => throw new NotImplementedException();
    public static string RoundedPath(IReadOnlyList<Point> points, double radius = Connector.Corner) => throw new NotImplementedException();
    public static Point LabelPointOf(IReadOnlyList<Point> points, IReadOnlyList<Rect>? avoid = null) => throw new NotImplementedException();
    public static Route RouteConnector(Rect from, Rect to, Lane? lane = null, double? fromOffset = null, double? toOffset = null) => throw new NotImplementedException();
}

public sealed class ObstacleRouter
{
    public ObstacleRouter(IEnumerable<Rect> obstacles, double clearance = 14) => throw new NotImplementedException();
    public Route Route(Rect from, Rect to, Lane? lane = null, double? fromOffset = null, double? toOffset = null) => throw new NotImplementedException();
}

public sealed record RoutedEndpoints(Rect From, Rect To, string? FromId = null, string? ToId = null);

public sealed record RoutedEdge<T>(T Item, Route Route);

public static class EdgeRouter
{
    public static IReadOnlyList<RoutedEdge<T>> Route<T>(IReadOnlyList<T> items, Func<T, string> keyOf, Func<T, RoutedEndpoints?> endpointsOf, IReadOnlyList<Rect> obstacles) => throw new NotImplementedException();
}
