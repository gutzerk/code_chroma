using System.Text;

namespace CodeChroma.Canvas.Connectors;

/// <summary>Distances that shape every connector.</summary>
public static class Connector
{
    /// <summary>Straight run out of a box before the first turn, so an arrow leaves perpendicular to its side.</summary>
    public const double Stub = 18;
    /// <summary>Perpendicular separation between two arrows joining the same pair of blocks.</summary>
    public const double LaneGap = 14;
    /// <summary>Separation of arrow tips on one busy side; larger than LaneGap so they read as distinct points.</summary>
    public const double PortGap = 26;
    /// <summary>Elbow radius.</summary>
    public const double Corner = 8;
    /// <summary>Keeps a lane-shifted anchor off the side's own corners.</summary>
    public const double SidePad = 8;
}

/// <summary>A signed perpendicular shift (Offset) and the 0-based position within the pair's group (Rank).</summary>
public sealed record Lane(double Offset, int Rank);

/// <summary>A routed connector: an SVG path, a caption point, and the corner sequence.</summary>
public sealed record Route(string D, Point Label, IReadOnlyList<Point> Points);

/// <summary>Whiteboard-style orthogonal routing between two boxes (port of orthogonalRoute.ts).</summary>
public static class OrthogonalRoute
{
    private const double Epsilon = 0.01;
    private static readonly Lane NoLane = new(0, 0);

    public static Rect RectFromBox(double x, double y, double width, double height) =>
        new(x - width / 2, y - height / 2, width, height);

    /// <summary>Direction-insensitive pair key, so A to B and B to A share lanes.</summary>
    public static string PairKeyOf(string a, string b) =>
        string.CompareOrdinal(a, b) < 0 ? $"{a} {b}" : $"{b} {a}";

    /// <summary>Identity key of a rect by rounded geometry (obstacle dedup only; port grouping prefers stable ids).</summary>
    public static string RectKeyOf(Rect rect) =>
        $"{JsMath.Format(JsMath.Round(rect.Left))},{JsMath.Format(JsMath.Round(rect.Top))},{JsMath.Format(JsMath.Round(rect.Width))},{JsMath.Format(JsMath.Round(rect.Height))}";

    /// <summary>Spreads n arrows of one pair symmetrically around the centre line.</summary>
    public static IReadOnlyList<Lane> AssignLanes<T>(IReadOnlyList<T> items, Func<T, string> keyOf, double gap = Connector.LaneGap)
    {
        var counts = new Dictionary<string, int>();
        foreach (var item in items)
        {
            var key = keyOf(item);
            counts[key] = counts.GetValueOrDefault(key) + 1;
        }
        var seen = new Dictionary<string, int>();
        var lanes = new List<Lane>(items.Count);
        foreach (var item in items)
        {
            var key = keyOf(item);
            var rank = seen.GetValueOrDefault(key);
            seen[key] = rank + 1;
            var total = counts[key];
            lanes.Add(new Lane((rank - (total - 1) / 2.0) * gap, rank));
        }
        return lanes;
    }

    /// <summary>Spreads arrow endpoints along the box+side they attach to (each key is its own group).</summary>
    public static IReadOnlyList<double> AssignPorts(IReadOnlyList<string> keys, double gap = Connector.PortGap) =>
        AssignLanes(keys, k => k, gap).Select(l => l.Offset).ToList();

    /// <summary>The sides two boxes are left by and entered on: the axis they are separated along, else the dominant centre delta.</summary>
    public static (Side From, Side To) ChooseSides(Rect from, Rect to)
    {
        var gapX = Math.Max(to.Left - from.Right, from.Left - to.Right);
        var gapY = Math.Max(to.Top - from.Bottom, from.Top - to.Bottom);
        var dx = to.CenterX - from.CenterX;
        var dy = to.CenterY - from.CenterY;
        bool horizontal;
        if (gapX >= 0 && gapY < 0) horizontal = true;
        else if (gapY >= 0 && gapX < 0) horizontal = false;
        else horizontal = Math.Abs(dx) > Math.Abs(dy);

        if (horizontal) return dx >= 0 ? (Side.Right, Side.Left) : (Side.Left, Side.Right);
        return dy >= 0 ? (Side.Bottom, Side.Top) : (Side.Top, Side.Bottom);
    }

    /// <summary>The side's midpoint shifted along it by the lane offset, clamped to stay on the box.</summary>
    public static Point AnchorOf(Rect rect, Side side, double laneOffset = 0)
    {
        if (side is Side.Left or Side.Right)
        {
            var pad = Math.Min(Connector.SidePad, rect.Height / 4);
            return new Point(
                side == Side.Left ? rect.Left : rect.Right,
                Clamp(rect.CenterY + laneOffset, rect.Top + pad, rect.Top + rect.Height - pad));
        }
        var padX = Math.Min(Connector.SidePad, rect.Width / 4);
        return new Point(
            Clamp(rect.CenterX + laneOffset, rect.Left + padX, rect.Left + rect.Width - padX),
            side == Side.Top ? rect.Top : rect.Bottom);
    }

    /// <summary>The point a route reaches after its perpendicular straight run out of the side.</summary>
    public static Point StubPointOf(Point anchor, Side side)
    {
        var (dx, dy) = Direction(side);
        return new Point(anchor.X + dx * Connector.Stub, anchor.Y + dy * Connector.Stub);
    }

    /// <summary>Drops duplicate and collinear corners.</summary>
    public static IReadOnlyList<Point> Simplify(IReadOnlyList<Point> points)
    {
        var result = new List<Point>();
        foreach (var point in points)
        {
            if (result.Count > 0 && Math.Abs(result[^1].X - point.X) < Epsilon && Math.Abs(result[^1].Y - point.Y) < Epsilon) continue;
            result.Add(point);
        }
        var pruned = new List<Point>();
        for (var index = 0; index < result.Count; index++)
        {
            if (pruned.Count > 0 && index + 1 < result.Count)
            {
                var previous = pruned[^1];
                var next = result[index + 1];
                var cross = (result[index].X - previous.X) * (next.Y - previous.Y) - (result[index].Y - previous.Y) * (next.X - previous.X);
                if (Math.Abs(cross) < Epsilon) continue;
            }
            pruned.Add(result[index]);
        }
        return pruned;
    }

    /// <summary>An SVG path through the points with each corner rounded; the radius shrinks on short segments.</summary>
    public static string RoundedPath(IReadOnlyList<Point> points, double radius = Connector.Corner)
    {
        var path = Simplify(points);
        if (path.Count == 0) return "";
        var d = new StringBuilder($"M {Num(path[0].X)} {Num(path[0].Y)}");
        for (var index = 1; index < path.Count - 1; index++)
        {
            var (previous, corner, next) = (path[index - 1], path[index], path[index + 1]);
            var limit = Math.Min(radius, Math.Min(Hypot(corner.X - previous.X, corner.Y - previous.Y) / 2, Hypot(next.X - corner.X, next.Y - corner.Y) / 2));
            var entry = Towards(corner, previous, limit);
            var exit = Towards(corner, next, limit);
            d.Append($" L {Num(entry.X)} {Num(entry.Y)} Q {Num(corner.X)} {Num(corner.Y)} {Num(exit.X)} {Num(exit.Y)}");
        }
        var end = path[^1];
        return path.Count > 1 ? $"{d} L {Num(end.X)} {Num(end.Y)}" : d.ToString();
    }

    /// <summary>The arc-length midpoint of the line, or the midpoint of the longest segment that clears the avoid boxes.</summary>
    public static Point LabelPointOf(IReadOnlyList<Point> points, IReadOnlyList<Rect>? avoid = null)
    {
        avoid ??= Array.Empty<Rect>();
        var path = Simplify(points);
        if (path.Count < 2) return path.Count > 0 ? path[0] : new Point(0, 0);
        var mid = MidpointOf(path);
        if (!avoid.Any(rect => PointInRect(mid, rect))) return mid;
        var lengths = SegmentLengths(path);
        var segments = lengths
            .Select((length, index) => (Length: length, Index: index,
                Mid: new Point(JsMath.Round2((path[index].X + path[index + 1].X) / 2), JsMath.Round2((path[index].Y + path[index + 1].Y) / 2))))
            .OrderByDescending(s => s.Length)
            .ThenBy(s => s.Index)
            .ToList();
        var clear = segments.FirstOrDefault(s => !avoid.Any(rect => PointInRect(s.Mid, rect)));
        return (clear == default ? segments[0] : clear).Mid;
    }

    /// <summary>
    /// Routes one arrow the way a whiteboard tool does: out of a side at a right angle, rounded elbows, its own lane
    /// when other arrows join the same pair.
    /// </summary>
    public static Route RouteConnector(Rect from, Rect to, Lane? lane = null, double? fromOffset = null, double? toOffset = null)
    {
        lane ??= NoLane;
        var (fromSide, toSide) = ChooseSides(from, to);
        var a = AnchorOf(from, fromSide, fromOffset ?? lane.Offset);
        var b = AnchorOf(to, toSide, toOffset ?? lane.Offset);
        var points = ElbowPoints(from, to, fromSide, toSide, a, b, lane);
        return new Route(RoundedPath(points), LabelPointOf(points, new[] { from, to }), points);
    }

    private static List<Point> ElbowPoints(Rect from, Rect to, Side fromSide, Side toSide, Point a, Point b, Lane lane)
    {
        var (outAx, outAy) = Direction(fromSide);
        var (outBx, outBy) = Direction(toSide);
        var stub = Connector.Stub;
        var a2 = new Point(a.X + outAx * stub, a.Y + outAy * stub);
        var b2 = new Point(b.X + outBx * stub, b.Y + outBy * stub);

        if (IsHorizontal(fromSide) != IsHorizontal(toSide))
        {
            var corner = IsHorizontal(fromSide) ? new Point(b2.X, a2.Y) : new Point(a2.X, b2.Y);
            return new List<Point> { a, a2, corner, b2, b };
        }

        if (IsHorizontal(fromSide))
        {
            var facing = (b2.X - a2.X) * outAx > 0;
            if (facing)
            {
                var mid = (a2.X + b2.X) / 2 + lane.Offset;
                return new List<Point> { a, a2, new(mid, a2.Y), new(mid, b2.Y), b2, b };
            }
            var top = Math.Min(from.Top, to.Top);
            var bottom = Math.Max(from.Bottom, to.Bottom);
            var goUp = a.Y - top <= bottom - a.Y;
            var spread = stub + lane.Rank * Connector.LaneGap;
            var y = goUp ? top - spread : bottom + spread;
            return new List<Point> { a, a2, new(a2.X, y), new(b2.X, y), b2, b };
        }

        var facingV = (b2.Y - a2.Y) * outAy > 0;
        if (facingV)
        {
            var mid = (a2.Y + b2.Y) / 2 + lane.Offset;
            return new List<Point> { a, a2, new(a2.X, mid), new(b2.X, mid), b2, b };
        }
        var left = Math.Min(from.Left, to.Left);
        var right = Math.Max(from.Right, to.Right);
        var goLeft = a.X - left <= right - a.X;
        var spreadV = stub + lane.Rank * Connector.LaneGap;
        var x = goLeft ? left - spreadV : right + spreadV;
        return new List<Point> { a, a2, new(x, a2.Y), new(x, b2.Y), b2, b };
    }

    private static (double X, double Y) Direction(Side side) => side switch
    {
        Side.Left => (-1, 0),
        Side.Right => (1, 0),
        Side.Top => (0, -1),
        _ => (0, 1),
    };

    private static bool IsHorizontal(Side side) => side is Side.Left or Side.Right;
    private static double Clamp(double value, double min, double max) => Math.Min(Math.Max(value, min), max);
    private static double Hypot(double dx, double dy) => Math.Sqrt(dx * dx + dy * dy);
    private static string Num(double value) => JsMath.Format(JsMath.Round2(value));

    private static Point Towards(Point from, Point to, double distance)
    {
        var dx = to.X - from.X;
        var dy = to.Y - from.Y;
        var length = Hypot(dx, dy);
        if (length == 0) length = 1;
        var ratio = Math.Min(distance / length, 1);
        return new Point(from.X + dx * ratio, from.Y + dy * ratio);
    }

    private static bool PointInRect(Point point, Rect rect) =>
        point.X >= rect.Left && point.X <= rect.Right && point.Y >= rect.Top && point.Y <= rect.Bottom;

    private static List<double> SegmentLengths(IReadOnlyList<Point> path) =>
        path.Take(path.Count - 1).Select((p, i) => Math.Abs(path[i + 1].X - p.X) + Math.Abs(path[i + 1].Y - p.Y)).ToList();

    private static Point MidpointOf(IReadOnlyList<Point> path)
    {
        var lengths = SegmentLengths(path);
        var remaining = lengths.Sum() / 2;
        for (var index = 0; index < lengths.Count; index++)
        {
            if (remaining <= lengths[index]) return Towards(path[index], path[index + 1], remaining);
            remaining -= lengths[index];
        }
        return path[^1];
    }
}
