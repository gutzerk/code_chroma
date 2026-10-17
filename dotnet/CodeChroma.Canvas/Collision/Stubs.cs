namespace CodeChroma.Canvas.Collision;

public static class CollisionConstants
{
    public const double ElkNodeSep = 110, ElkRankSep = 160, NodeSep = 24, RankSep = 24, RingStep = ElkNodeSep, LandingHysteresisPx = 8;
    public const int MaxRing = 12, SettleMs = 160;
}

public sealed record Obstacle(string Id, Box Bounds);

public sealed record DropResolution(double X, double Y, bool Blocked);

public sealed class ResolveDropOptions
{
    public double? NodeSep { get; init; }
    public double? RankSep { get; init; }
    public int? MaxRing { get; init; }
    public double? RingStep { get; init; }
}

public static class DropResolver
{
    public static DropResolution Resolve(Box moving, IReadOnlyList<Obstacle> obstacles, ResolveDropOptions? options = null) => throw new NotImplementedException();
    public static bool HasCollision(Box moving, IReadOnlyList<Obstacle> obstacles, ResolveDropOptions? options = null) => throw new NotImplementedException();
}

public sealed class CollisionRegistry
{
    public IDisposable Register(string id, Func<Box?> bounds, string? containerId = null, bool inCanvasSpace = true) => throw new NotImplementedException();
    public void BeginGesture() => throw new NotImplementedException();
    public void EndGesture() => throw new NotImplementedException();
    public IReadOnlyList<Obstacle> ObstaclesExcept(string id) => throw new NotImplementedException();
}
