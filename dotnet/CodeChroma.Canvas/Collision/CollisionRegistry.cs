namespace CodeChroma.Canvas.Collision;

/// <summary>
/// Registry of the boxes the drop solver treats as hard obstacles (C1 anchors, floating plan and review panels).
/// Boxes come from the model in canvas coordinates, so unlike collisionStore.ts nothing is read from a live DOM and
/// nothing is divided by the zoom: the scale lives in the viewport, not here. A gesture freezes the whole set on its
/// first frame, because the scene does not move while one block is being dragged.
/// </summary>
public sealed class CollisionRegistry
{
    private sealed record Participant(string Id, Func<Box?> Bounds, string? ContainerId, bool InCanvasSpace);

    private sealed record Snapshot(string Id, Box Bounds, string? ContainerId);

    private readonly Dictionary<string, Participant> _participants = new();
    private List<Snapshot>? _frozen;

    /// <summary>Registers a participant; disposing the result unregisters it, so a closed panel leaves no phantom obstacle.</summary>
    public IDisposable Register(string id, Func<Box?> bounds, string? containerId = null, bool inCanvasSpace = true)
    {
        var participant = new Participant(id, bounds, containerId, inCanvasSpace);
        _participants[id] = participant;
        return new Registration(() =>
        {
            if (_participants.TryGetValue(id, out var current) && ReferenceEquals(current, participant)) _participants.Remove(id);
        });
    }

    public void BeginGesture() => _frozen = ReadAll();

    public void EndGesture() => _frozen = null;

    /// <summary>Every participant box except the dragged block, anything it is nested inside, and anything nested inside it.</summary>
    public IReadOnlyList<Obstacle> ObstaclesExcept(string id)
    {
        var all = _frozen ?? ReadAll();
        var containers = all.ToDictionary(s => s.Id, s => s.ContainerId);
        return all
            .Where(s => s.Id != id && !IsAncestor(s.Id, id, containers) && !IsAncestor(id, s.Id, containers))
            .Select(s => new Obstacle(s.Id, s.Bounds))
            .ToList();
    }

    private static bool IsAncestor(string candidate, string of, IReadOnlyDictionary<string, string?> containers)
    {
        var seen = new HashSet<string>();
        var current = containers.GetValueOrDefault(of);
        while (current is not null && seen.Add(current))
        {
            if (current == candidate) return true;
            current = containers.GetValueOrDefault(current);
        }
        return false;
    }

    private List<Snapshot> ReadAll()
    {
        var result = new List<Snapshot>();
        foreach (var participant in _participants.Values)
        {
            if (!participant.InCanvasSpace) continue;
            var box = participant.Bounds();
            if (box is null || box.Value.Width <= 0 || box.Value.Height <= 0) continue;
            result.Add(new Snapshot(participant.Id, box.Value, participant.ContainerId));
        }
        return result;
    }

    private sealed class Registration : IDisposable
    {
        private Action? _dispose;
        public Registration(Action dispose) => _dispose = dispose;
        public void Dispose() { _dispose?.Invoke(); _dispose = null; }
    }
}
