namespace CodeChroma.Bridge.Questions;

/// <summary>The `ask_user` contract: field checks, the rejection text and the per-agent retry counter.</summary>
public static class QuestionValidation
{
    public const int MinOptions = 2;
    public const int MaxOptions = 4;
    private const string Footer = "Call ask_user again with all fields. Keep the original intent and options. Do not ask in terminal text.";

    /// <summary>One line per contract problem; empty when the question may be shown.</summary>
    public static List<string> Validate(AskRequest request)
    {
        var problems = new List<string>();
        if (string.IsNullOrWhiteSpace(request.Question)) problems.Add("question is empty");
        var options = request.Options;
        if (options.Count < MinOptions || options.Count > MaxOptions) problems.Add($"give {MinOptions}-{MaxOptions} options, got {options.Count}");
        if (options.Select(o => o.Id).Distinct().Count() != options.Count) problems.Add("option ids are not unique");
        foreach (var option in options)
        {
            var label = option.Title.Length > 0 ? option.Title : option.Id;
            foreach (var (name, value) in new[] { ("title", option.Title), ("description", option.Description), ("pro", option.Pro), ("con", option.Con), ("why", option.Why) })
                if (string.IsNullOrWhiteSpace(value)) problems.Add($"Option \"{label}\": missing {name}");
        }
        var ranks = options.Select(o => o.Rank).ToList();
        if (ranks.Count(r => r == 1) != 1) problems.Add("exactly one option must have rank 1");
        var given = ranks.Where(r => r is not null).ToList();
        if (given.Distinct().Count() != given.Count) problems.Add("ranks are not unique");
        if (request.Kind == "diagram" && !options.Any(o => !string.IsNullOrEmpty(o.DiagramRef)))
            problems.Add("kind \"diagram\" needs a diagram_ref on at least one option");
        return problems;
    }

    /// <summary>One line per `diagram_ref` that names no canvas element.</summary>
    public static List<string> UnknownRefs(AskRequest request, IEnumerable<string> knownIds)
    {
        var known = knownIds.ToHashSet();
        return request.Options
            .Where(o => !string.IsNullOrEmpty(o.DiagramRef) && !known.Contains(o.DiagramRef))
            .Select(o => $"Option \"{(o.Title.Length > 0 ? o.Title : o.Id)}\": diagram_ref '{o.DiagramRef}' is unknown")
            .ToList();
    }

    /// <summary>The fixed-shape tool error: header, one bullet per problem, then the footer.</summary>
    public static string RejectionText(IEnumerable<string> problems, string subject = "question") =>
        string.Join("\n", [$"CodeChroma rejected the {subject}.", .. problems.Select(p => "- " + p), Footer]);
}

/// <summary>Counts consecutive rejections per (workspace, session); a null session is never tracked.</summary>
public sealed class RejectionTracker(Func<double>? clock = null, int maxEntries = RejectionTracker.MaxTracked)
{
    public const double ResetAfterSeconds = 600.0;
    public const int MaxTracked = 1000;

    private readonly Func<double> _clock = clock ?? (() => Environment.TickCount64 / 1000.0);
    private readonly object _lock = new();
    private readonly Dictionary<(string, string), (int Count, double At)> _entries = [];
    private readonly List<(string, string)> _order = [];

    public int Size { get { lock (_lock) return _entries.Count; } }

    /// <summary>Rejections so far; zero once the entry has been silent for ten minutes.</summary>
    public int Count(string workspaceId, string? sessionId)
    {
        lock (_lock) return CountLocked(workspaceId, sessionId);
    }

    /// <summary>Counts one more rejection; untracked without a session id.</summary>
    public void Record(string workspaceId, string? sessionId)
    {
        if (string.IsNullOrEmpty(sessionId)) return;
        lock (_lock)
        {
            var total = CountLocked(workspaceId, sessionId) + 1;
            Evict();
            var key = (workspaceId, sessionId);
            if (!_entries.ContainsKey(key)) _order.Add(key);
            _entries[key] = (total, _clock());
        }
    }

    /// <summary>Forgets the count after a valid question, an answer or a degraded pass-through.</summary>
    public void Reset(string workspaceId, string? sessionId)
    {
        if (sessionId is null) return;
        lock (_lock)
        {
            _entries.Remove((workspaceId, sessionId));
            _order.Remove((workspaceId, sessionId));
        }
    }

    private int CountLocked(string workspaceId, string? sessionId)
    {
        if (string.IsNullOrEmpty(sessionId) || !_entries.TryGetValue((workspaceId, sessionId), out var entry)) return 0;
        return _clock() - entry.At > ResetAfterSeconds ? 0 : entry.Count;
    }

    private void Evict()
    {
        var now = _clock();
        foreach (var key in _order.Where(k => now - _entries[k].At > ResetAfterSeconds).ToList())
        {
            _entries.Remove(key);
            _order.Remove(key);
        }
        while (_order.Count > 0 && _entries.Count >= maxEntries)
        {
            _entries.Remove(_order[0]);
            _order.RemoveAt(0);
        }
    }
}
