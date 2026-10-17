namespace CodeChroma.Canvas.Connectors;

/// <summary>
/// An orthogonal router that steers around every box on the canvas, not just the two an arrow joins (port of
/// obstacleRouter.ts). Stateful on purpose: it remembers the corridors earlier arrows claimed and charges a
/// penalty for reusing one, so build one per layout pass, call it for every edge in a stable order, and discard it.
/// The nesting skip rule is load-bearing: an obstacle that contains either endpoint's anchor is dropped for that
/// route, otherwise a nested block could never leave its parent.
/// </summary>
public sealed class ObstacleRouter
{
    private const double Epsilon = 0.01;
    private const double TurnPenalty = 30;
    private const double ReusePenalty = 150;
    private const double DetourMargin = 180;
    private const int WideRetry = 3;
    private const int MaxObstacles = 120;
    private const int MaxLinesPerAxis = 48;
    private const double CrossingMargin = 4;
    private const int Horizontal = 0;
    private const int Vertical = 1;

    private sealed record Corridor(bool Horizontal, double Fixed, double Lo, double Hi);

    private sealed record PaddedObstacle(Rect Raw, Rect Padded);

    private sealed class Grid
    {
        public double[] Xs = Array.Empty<double>();
        public double[] Ys = Array.Empty<double>();
        public double[] HorizontalCost = Array.Empty<double>();
        public double[] VerticalCost = Array.Empty<double>();
    }

    private readonly List<PaddedObstacle> _padded;
    private readonly List<Corridor> _claimed = new();
    private readonly bool _degraded;

    public ObstacleRouter(IEnumerable<Rect> obstacles, double clearance = 14)
    {
        var order = new List<string>();
        var byKey = new Dictionary<string, Rect>();
        foreach (var rect in obstacles)
        {
            var key = OrthogonalRoute.RectKeyOf(rect);
            if (!byKey.ContainsKey(key)) order.Add(key);
            byKey[key] = rect;
        }
        var unique = order.Select(k => byKey[k]).ToList();
        _degraded = unique.Count == 0 || unique.Count > MaxObstacles;
        _padded = _degraded ? new List<PaddedObstacle>() : unique.Select(raw => new PaddedObstacle(raw, Inflate(raw, clearance))).ToList();
    }

    public Route Route(Rect from, Rect to, Lane? lane = null, double? fromOffset = null, double? toOffset = null)
    {
        if (_degraded) return OrthogonalRoute.RouteConnector(from, to, lane, fromOffset, toOffset);

        var fromOff = fromOffset ?? lane?.Offset ?? 0;
        var toOff = toOffset ?? lane?.Offset ?? 0;
        var direct = OrthogonalRoute.RouteConnector(from, to, lane, fromOff, toOff);
        var (fromSide, toSide) = OrthogonalRoute.ChooseSides(from, to);
        var a = OrthogonalRoute.AnchorOf(from, fromSide, fromOff);
        var b = OrthogonalRoute.AnchorOf(to, toSide, toOff);
        var blockers = BlockersFor(from, to, a, b);

        var inTheWay = blockers
            .Where(o => !SameRect(o.Raw, from) && !SameRect(o.Raw, to))
            .Select(o => Inflate(o.Raw, CrossingMargin))
            .ToList();
        var mustReroute = CrossesAnyBox(direct.Points, inTheWay) || OverlapsAnyCorridor(direct.Points, from, to);
        if (!mustReroute) return Finish(direct.Points, from, to);

        return Attempt(from, to, fromSide, toSide, a, b, blockers, DetourMargin)
            ?? Attempt(from, to, fromSide, toSide, a, b, blockers, DetourMargin * WideRetry)
            ?? Finish(direct.Points, from, to);
    }

    private List<PaddedObstacle> BlockersFor(Rect from, Rect to, Point a, Point b)
    {
        var result = new List<PaddedObstacle>();
        foreach (var obstacle in _padded)
        {
            if (SameRect(obstacle.Raw, from) || SameRect(obstacle.Raw, to))
            {
                result.Add(new PaddedObstacle(obstacle.Raw, Inflate(obstacle.Raw, -Epsilon * 2)));
                continue;
            }
            if (Contains(obstacle.Raw, a) || Contains(obstacle.Raw, b)) continue;
            result.Add(obstacle);
        }
        return result;
    }

    private Route Finish(IReadOnlyList<Point> points, Rect from, Rect to)
    {
        var simplified = OrthogonalRoute.Simplify(points);
        _claimed.AddRange(CorridorsOf(simplified));
        return new Route(OrthogonalRoute.RoundedPath(simplified), OrthogonalRoute.LabelPointOf(simplified, new[] { from, to }), simplified);
    }

    private bool OverlapsAnyCorridor(IReadOnlyList<Point> points, Rect from, Rect to)
    {
        var spanLo = Math.Min(Math.Min(from.Left, to.Left), Math.Min(from.Top, to.Top));
        var spanHi = Math.Max(Math.Max(from.Right, to.Right), Math.Max(from.Bottom, to.Bottom));
        foreach (var mine in CorridorsOf(points))
        {
            foreach (var theirs in _claimed)
            {
                if (mine.Horizontal == theirs.Horizontal
                    && Math.Abs(mine.Fixed - theirs.Fixed) < Epsilon
                    && mine.Lo < Math.Min(theirs.Hi, spanHi) - Epsilon
                    && Math.Max(theirs.Lo, spanLo) < mine.Hi - Epsilon)
                    return true;
            }
        }
        return false;
    }

    private Route? Attempt(Rect from, Rect to, Side fromSide, Side toSide, Point a, Point b, List<PaddedObstacle> blockers, double margin)
    {
        var a2 = OrthogonalRoute.StubPointOf(a, fromSide);
        var b2 = OrthogonalRoute.StubPointOf(b, toSide);
        var region = Inflate(
            new Rect(Math.Min(from.Left, to.Left), Math.Min(from.Top, to.Top),
                Math.Max(from.Right, to.Right) - Math.Min(from.Left, to.Left),
                Math.Max(from.Bottom, to.Bottom) - Math.Min(from.Top, to.Top)),
            margin);

        var active = blockers.Where(o => o.Padded.Intersects(region)).ToList();
        var xs = AxisLines(active.SelectMany(o => new[] { o.Padded.Left, o.Padded.Right })
            .Concat(new[] { a.X, a2.X, b.X, b2.X, region.Left, region.Right }));
        var ys = AxisLines(active.SelectMany(o => new[] { o.Padded.Top, o.Padded.Bottom })
            .Concat(new[] { a.Y, a2.Y, b.Y, b2.Y, region.Top, region.Bottom }));

        var grid = BuildGrid(xs, ys, active, _claimed.Where(c => CorridorNearRegion(c, region)).ToList());
        var stubDirection = (Math.Sign(a2.X - a.X), Math.Sign(a2.Y - a.Y));
        var path = SearchGrid(grid, a2, b2, stubDirection);
        if (path is null) return null;

        var full = new List<Point> { a, a2 };
        full.AddRange(path);
        full.Add(b2);
        full.Add(b);
        return Finish(full, from, to);
    }

    private static bool CrossesAnyBox(IReadOnlyList<Point> points, IReadOnlyList<Rect> candidates)
    {
        for (var index = 0; index + 1 < points.Count; index++)
        {
            var (a, b) = (points[index], points[index + 1]);
            var segment = new Rect(Math.Min(a.X, b.X), Math.Min(a.Y, b.Y), Math.Abs(b.X - a.X), Math.Abs(b.Y - a.Y));
            if (candidates.Any(box => segment.Intersects(box))) return true;
        }
        return false;
    }

    private static double[] AxisLines(IEnumerable<double> values)
    {
        var sorted = values.Select(JsMath.Round2).Distinct().OrderBy(v => v).ToList();
        var withMidpoints = new List<double>();
        for (var index = 0; index < sorted.Count; index++)
        {
            withMidpoints.Add(sorted[index]);
            if (index + 1 < sorted.Count) withMidpoints.Add((sorted[index] + sorted[index + 1]) / 2);
        }
        return withMidpoints.Count <= MaxLinesPerAxis ? withMidpoints.ToArray() : sorted.Take(MaxLinesPerAxis).ToArray();
    }

    private static int IndexOfNearest(double[] values, double target)
    {
        var best = 0;
        var bestDistance = double.PositiveInfinity;
        for (var index = 0; index < values.Length; index++)
        {
            var distance = Math.Abs(values[index] - target);
            if (distance < bestDistance) { bestDistance = distance; best = index; }
        }
        return best;
    }

    private static (int From, int To) SpanWithin(double[] values, double lo, double hi)
    {
        var from = 0;
        while (from < values.Length && values[from] <= lo + Epsilon) from++;
        var to = from;
        while (to < values.Length && values[to] < hi - Epsilon) to++;
        return (from, to);
    }

    private static Grid BuildGrid(double[] xs, double[] ys, IReadOnlyList<PaddedObstacle> obstacles, IReadOnlyList<Corridor> corridors)
    {
        int nx = xs.Length, ny = ys.Length;
        var xMid = xs.Take(nx - 1).Select((v, i) => (v + xs[i + 1]) / 2).ToArray();
        var yMid = ys.Take(ny - 1).Select((v, i) => (v + ys[i + 1]) / 2).ToArray();
        var horizontalCost = new double[Math.Max(0, (nx - 1) * ny)];
        var verticalCost = new double[Math.Max(0, nx * (ny - 1))];
        for (var j = 0; j < ny; j++)
            for (var i = 0; i + 1 < nx; i++) horizontalCost[j * (nx - 1) + i] = xs[i + 1] - xs[i];
        for (var j = 0; j + 1 < ny; j++)
            for (var i = 0; i < nx; i++) verticalCost[j * nx + i] = ys[j + 1] - ys[j];

        foreach (var obstacle in obstacles)
        {
            var padded = obstacle.Padded;
            var (xFrom, xTo) = SpanWithin(xMid, padded.Left, padded.Right);
            var (yFrom, yTo) = SpanWithin(ys, padded.Top, padded.Bottom);
            for (var j = yFrom; j < yTo; j++)
                for (var i = xFrom; i < xTo; i++) horizontalCost[j * (nx - 1) + i] = double.PositiveInfinity;
            var (xFrom2, xTo2) = SpanWithin(xs, padded.Left, padded.Right);
            var (yFrom2, yTo2) = SpanWithin(yMid, padded.Top, padded.Bottom);
            for (var j = yFrom2; j < yTo2; j++)
                for (var i = xFrom2; i < xTo2; i++) verticalCost[j * nx + i] = double.PositiveInfinity;
        }

        foreach (var corridor in corridors)
        {
            if (corridor.Horizontal)
            {
                var j = Array.FindIndex(ys, v => Math.Abs(v - corridor.Fixed) < Epsilon);
                if (j < 0) continue;
                var (from, to) = SpanWithin(xMid, corridor.Lo, corridor.Hi);
                for (var i = from; i < to; i++) horizontalCost[j * (nx - 1) + i] += ReusePenalty;
            }
            else
            {
                var i = Array.FindIndex(xs, v => Math.Abs(v - corridor.Fixed) < Epsilon);
                if (i < 0) continue;
                var (from, to) = SpanWithin(yMid, corridor.Lo, corridor.Hi);
                for (var j = from; j < to; j++) verticalCost[j * nx + i] += ReusePenalty;
            }
        }
        return new Grid { Xs = xs, Ys = ys, HorizontalCost = horizontalCost, VerticalCost = verticalCost };
    }

    private static List<Point>? SearchGrid(Grid grid, Point start, Point goal, (int X, int Y) stubDirection)
    {
        var (xs, ys, horizontalCost, verticalCost) = (grid.Xs, grid.Ys, grid.HorizontalCost, grid.VerticalCost);
        var startAxis = stubDirection.X != 0 ? Horizontal : Vertical;
        int nx = xs.Length, ny = ys.Length;
        var startX = IndexOfNearest(xs, start.X);
        var startY = IndexOfNearest(ys, start.Y);
        var goalX = IndexOfNearest(xs, goal.X);
        var goalY = IndexOfNearest(ys, goal.Y);

        var stateCount = nx * ny * 2;
        var best = new double[stateCount];
        Array.Fill(best, double.PositiveInfinity);
        var cameFrom = new int[stateCount];
        Array.Fill(cameFrom, -1);
        int StateOf(int x, int y, int axis) => (y * nx + x) * 2 + axis;
        double Heuristic(int x, int y) => Math.Abs(xs[x] - xs[goalX]) + Math.Abs(ys[y] - ys[goalY]);

        var open = new Heap();
        var startState = StateOf(startX, startY, startAxis);
        best[startState] = 0;
        open.Push(startState, Heuristic(startX, startY));

        var goalState = -1;
        while (open.Size > 0)
        {
            var state = open.Pop();
            var cell = state >> 1;
            var axis = state & 1;
            var x = cell % nx;
            var y = (cell - x) / nx;
            if (x == goalX && y == goalY) { goalState = state; break; }
            var cost = best[state];

            for (var move = 0; move < 4; move++)
            {
                var dx = move == 0 ? 1 : move == 1 ? -1 : 0;
                var dy = move == 2 ? 1 : move == 3 ? -1 : 0;
                if (state == startState && dx == -stubDirection.X && dy == -stubDirection.Y) continue;
                var nextX = x + dx;
                var nextY = y + dy;
                if (nextX < 0 || nextX >= nx || nextY < 0 || nextY >= ny) continue;

                var nextAxis = dx != 0 ? Horizontal : Vertical;
                var step = dx != 0
                    ? horizontalCost[y * (nx - 1) + Math.Min(x, nextX)]
                    : verticalCost[Math.Min(y, nextY) * nx + x];
                if (double.IsInfinity(step)) continue;

                var nextCost = cost + step + (nextAxis == axis ? 0 : TurnPenalty);
                var nextState = StateOf(nextX, nextY, nextAxis);
                if (nextCost >= best[nextState]) continue;
                best[nextState] = nextCost;
                cameFrom[nextState] = state;
                open.Push(nextState, nextCost + Heuristic(nextX, nextY));
            }
        }

        if (goalState < 0) return null;
        var points = new List<Point>();
        for (var state = goalState; state >= 0; state = cameFrom[state])
        {
            var cell = state >> 1;
            var x = cell % nx;
            points.Add(new Point(xs[x], ys[(cell - x) / nx]));
        }
        points.Reverse();
        return points;
    }

    private static List<Corridor> CorridorsOf(IReadOnlyList<Point> points)
    {
        var corridors = new List<Corridor>();
        for (var index = 0; index + 1 < points.Count; index++)
        {
            var (a, b) = (points[index], points[index + 1]);
            if (Math.Abs(a.Y - b.Y) < Epsilon && Math.Abs(a.X - b.X) >= Epsilon)
                corridors.Add(new Corridor(true, a.Y, Math.Min(a.X, b.X), Math.Max(a.X, b.X)));
            else if (Math.Abs(a.X - b.X) < Epsilon && Math.Abs(a.Y - b.Y) >= Epsilon)
                corridors.Add(new Corridor(false, a.X, Math.Min(a.Y, b.Y), Math.Max(a.Y, b.Y)));
        }
        return corridors;
    }

    private static bool CorridorNearRegion(Corridor corridor, Rect region) =>
        corridor.Horizontal
            ? corridor.Fixed >= region.Top && corridor.Fixed <= region.Bottom && corridor.Lo <= region.Right && corridor.Hi >= region.Left
            : corridor.Fixed >= region.Left && corridor.Fixed <= region.Right && corridor.Lo <= region.Bottom && corridor.Hi >= region.Top;

    private static Rect Inflate(Rect rect, double by) => new(rect.Left - by, rect.Top - by, rect.Width + by * 2, rect.Height + by * 2);

    private static bool Contains(Rect rect, Point point) =>
        point.X >= rect.Left - Epsilon && point.X <= rect.Right + Epsilon && point.Y >= rect.Top - Epsilon && point.Y <= rect.Bottom + Epsilon;

    private static bool SameRect(Rect a, Rect b) =>
        Math.Abs(a.Left - b.Left) < Epsilon && Math.Abs(a.Top - b.Top) < Epsilon
        && Math.Abs(a.Width - b.Width) < Epsilon && Math.Abs(a.Height - b.Height) < Epsilon;

    /// <summary>Binary min-heap over (priority, insertion order), so equal-cost states pop in a fixed order.</summary>
    private sealed class Heap
    {
        private readonly List<(double Cost, long Seq, int State)> _items = new();
        private long _seq;

        public int Size => _items.Count;

        public void Push(int state, double cost)
        {
            _items.Add((cost, _seq++, state));
            var index = _items.Count - 1;
            while (index > 0)
            {
                var parent = (index - 1) >> 1;
                if (!Less(index, parent)) break;
                (_items[index], _items[parent]) = (_items[parent], _items[index]);
                index = parent;
            }
        }

        public int Pop()
        {
            var top = _items[0];
            var last = _items[^1];
            _items.RemoveAt(_items.Count - 1);
            if (_items.Count > 0)
            {
                _items[0] = last;
                var index = 0;
                for (;;)
                {
                    var left = index * 2 + 1;
                    var right = left + 1;
                    var smallest = index;
                    if (left < _items.Count && Less(left, smallest)) smallest = left;
                    if (right < _items.Count && Less(right, smallest)) smallest = right;
                    if (smallest == index) break;
                    (_items[index], _items[smallest]) = (_items[smallest], _items[index]);
                    index = smallest;
                }
            }
            return top.State;
        }

        private bool Less(int a, int b) =>
            _items[a].Cost != _items[b].Cost ? _items[a].Cost < _items[b].Cost : _items[a].Seq < _items[b].Seq;
    }
}
