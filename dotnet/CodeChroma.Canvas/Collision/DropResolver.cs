namespace CodeChroma.Canvas.Collision;

/// <summary>The collision-avoidance geometry shared by the drop solver and the auto layout (collision/constants.ts).</summary>
public static class CollisionConstants
{
    /// <summary>Auto-layout spacing on X between neighbours in a row (not the drag rule).</summary>
    public const double ElkNodeSep = 110;
    /// <summary>Auto-layout spacing on Y between rows.</summary>
    public const double ElkRankSep = 160;
    /// <summary>Minimum gap on X a dragged block must keep.</summary>
    public const double NodeSep = 24;
    /// <summary>Minimum gap on Y a dragged block must keep.</summary>
    public const double RankSep = 24;
    /// <summary>Rings of the spiral fallback searched when no candidate position is free.</summary>
    public const int MaxRing = 12;
    /// <summary>Spiral ring spacing.</summary>
    public const double RingStep = ElkNodeSep;
}

/// <summary>A rectangle the dragged block must not land on top of; the id is only the last tie-break.</summary>
public sealed record Obstacle(string Id, Box Bounds);

/// <summary>Where the dragged block lands; Blocked means even the spiral found nothing and it stays where released.</summary>
public sealed record DropResolution(double X, double Y, bool Blocked);

public sealed class ResolveDropOptions
{
    public double? NodeSep { get; init; }
    public double? RankSep { get; init; }
    public int? MaxRing { get; init; }
    public double? RingStep { get; init; }
}

/// <summary>
/// Where the dragged block actually lands: the release point when it is already legal, otherwise the nearest
/// position that clears every obstacle by NodeSep on X and RankSep on Y. Pure: only the dragged block moves.
/// </summary>
public static class DropResolver
{
    private const double Epsilon = 1e-6;

    private readonly record struct Bounds(double Left, double Right, double Top, double Bottom);

    private readonly record struct Candidate(double X, double Y, string ObstacleId);

    public static bool HasCollision(Box moving, IReadOnlyList<Obstacle> obstacles, ResolveDropOptions? options = null)
    {
        var (padX, padY) = Padding(options);
        var movingBounds = Inflate(moving, padX, padY);
        return obstacles.Any(o => Overlaps(movingBounds, Inflate(o.Bounds, padX, padY)));
    }

    public static DropResolution Resolve(Box moving, IReadOnlyList<Obstacle> obstacles, ResolveDropOptions? options = null)
    {
        var (padX, padY) = Padding(options);
        var maxRing = options?.MaxRing ?? CollisionConstants.MaxRing;
        var ringStep = options?.RingStep ?? CollisionConstants.RingStep;

        var inflated = obstacles.Select(o => (o.Id, Bounds: Inflate(o.Bounds, padX, padY))).ToList();
        var movingBounds = Inflate(moving, padX, padY);
        var hit = inflated.Where(o => Overlaps(movingBounds, o.Bounds)).ToList();
        if (hit.Count == 0) return new DropResolution(moving.X, moving.Y, false);

        bool IsFree(Candidate candidate)
        {
            var bounds = Inflate(new Box(candidate.X, candidate.Y, moving.Width, moving.Height), padX, padY);
            return !inflated.Any(o => Overlaps(bounds, o.Bounds));
        }

        var candidates = hit
            .SelectMany(o => CandidatesFor(movingBounds, o.Bounds, o.Id, moving))
            .ToList();
        candidates.Sort((a, b) => Compare(a, b, moving));
        foreach (var candidate in candidates)
            if (IsFree(candidate)) return new DropResolution(candidate.X, candidate.Y, false);

        for (var ring = 1; ring <= maxRing; ring++)
            foreach (var candidate in RingCandidates(ring, ringStep, moving))
                if (IsFree(candidate)) return new DropResolution(candidate.X, candidate.Y, false);

        return new DropResolution(moving.X, moving.Y, true);
    }

    private static (double PadX, double PadY) Padding(ResolveDropOptions? options) =>
        ((options?.NodeSep ?? CollisionConstants.NodeSep) / 2, (options?.RankSep ?? CollisionConstants.RankSep) / 2);

    private static Bounds Inflate(Box box, double padX, double padY) =>
        new(box.X - padX, box.X + box.Width + padX, box.Y - padY, box.Y + box.Height + padY);

    private static bool Overlaps(Bounds a, Bounds b) =>
        a.Left < b.Right - Epsilon && b.Left < a.Right - Epsilon && a.Top < b.Bottom - Epsilon && b.Top < a.Bottom - Epsilon;

    /// <summary>Distance, then |dy|, then |dx|, then obstacle id, then signed position: a TOTAL order so an identical scene resolves identically.</summary>
    private static int Compare(Candidate a, Candidate b, Box from)
    {
        var da = Hypot(a.X - from.X, a.Y - from.Y);
        var db = Hypot(b.X - from.X, b.Y - from.Y);
        if (Math.Abs(da - db) > Epsilon) return da.CompareTo(db);
        var dya = Math.Abs(a.Y - from.Y);
        var dyb = Math.Abs(b.Y - from.Y);
        if (Math.Abs(dya - dyb) > Epsilon) return dya.CompareTo(dyb);
        var dxa = Math.Abs(a.X - from.X);
        var dxb = Math.Abs(b.X - from.X);
        if (Math.Abs(dxa - dxb) > Epsilon) return dxa.CompareTo(dxb);
        if (a.ObstacleId != b.ObstacleId) return string.CompareOrdinal(a.ObstacleId, b.ObstacleId) < 0 ? -1 : 1;
        if (a.Y != b.Y) return a.Y.CompareTo(b.Y);
        return a.X.CompareTo(b.X);
    }

    private static double Hypot(double dx, double dy) => Math.Sqrt(dx * dx + dy * dy);

    /// <summary>The four minimum-translation exits out of one obstacle plus the eight edge-flush alignments.</summary>
    private static IEnumerable<Candidate> CandidatesFor(Bounds moving, Bounds obstacle, string obstacleId, Box at)
    {
        var shifts = new (double Dx, double Dy)[]
        {
            (obstacle.Left - moving.Right, 0),
            (obstacle.Right - moving.Left, 0),
            (0, obstacle.Top - moving.Bottom),
            (0, obstacle.Bottom - moving.Top),
            (obstacle.Left - moving.Left, 0),
            (obstacle.Right - moving.Right, 0),
            (0, obstacle.Top - moving.Top),
            (0, obstacle.Bottom - moving.Bottom),
        };
        return shifts.Select(s => new Candidate(at.X + s.Dx, at.Y + s.Dy, obstacleId));
    }

    private static List<Candidate> RingCandidates(int ring, double step, Box at)
    {
        var points = new List<Candidate>();
        for (var i = -ring; i <= ring; i++)
            for (var j = -ring; j <= ring; j++)
            {
                if (Math.Max(Math.Abs(i), Math.Abs(j)) != ring) continue;
                points.Add(new Candidate(at.X + i * step, at.Y + j * step, ""));
            }
        points.Sort((a, b) => Compare(a, b, at));
        return points;
    }
}
