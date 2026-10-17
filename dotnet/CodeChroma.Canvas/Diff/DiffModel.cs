using System.Text.Json.Serialization;

namespace CodeChroma.Canvas.Diff;

/// <summary>A function whose disk source differs from git HEAD (GET /repos/{id}/diff).</summary>
public sealed record FunctionDiff
{
    [JsonPropertyName("node_id")] public string NodeId { get; init; } = "";
    [JsonPropertyName("original_source")] public string OriginalSource { get; init; } = "";
    [JsonPropertyName("proposed_source")] public string ProposedSource { get; init; } = "";
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("level")] public string? Level { get; init; }
}

/// <summary>One deterministic change pinned to the nearest existing block (GET /repos/{id}/change-cards).</summary>
public sealed record ChangeCard
{
    [JsonPropertyName("node_id")] public string NodeId { get; init; } = "";
    [JsonPropertyName("kind")] public string Kind { get; init; } = "modify";
    [JsonPropertyName("text")] public string Text { get; init; } = "";
    [JsonPropertyName("file")] public string File { get; init; } = "";
    [JsonPropertyName("symbol")] public string? Symbol { get; init; }
    [JsonPropertyName("name")] public string Name { get; init; } = "";
    [JsonPropertyName("target")] public string Target { get; init; } = "function";
    [JsonPropertyName("status")] public string Status { get; init; } = "modified";
    [JsonPropertyName("added_lines")] public int AddedLines { get; init; }
    [JsonPropertyName("removed_lines")] public int RemovedLines { get; init; }
    [JsonPropertyName("binary")] public bool Binary { get; init; }
    /// <summary>Set when the card resolved to an ancestor of the changed symbol rather than the symbol's own block.</summary>
    [JsonPropertyName("resolution")] public string? Resolution { get; init; }

    /// <summary>The always-visible second line: where the change is and how big it is.</summary>
    public string Meta
    {
        get
        {
            var where = Symbol is { Length: > 0 } ? $"{File} · {Symbol}" : File;
            return Binary ? $"{where} · binary" : $"{where} · +{AddedLines} −{RemovedLines}";
        }
    }
}

public sealed record ChangeCardSet
{
    [JsonPropertyName("base_resolved")] public bool BaseResolved { get; init; } = true;
    [JsonPropertyName("cards")] public List<ChangeCard> Cards { get; init; } = new();
    [JsonPropertyName("by_node_status")] public Dictionary<string, string> ByNodeStatus { get; init; } = new();
}

/// <summary>The diff endpoints the controller needs; the real client is the bridge, tests use a fake.</summary>
public interface IDiffBridge
{
    Task<IReadOnlyList<FunctionDiff>> GetDiffAsync(CancellationToken ct);
    Task<ChangeCardSet?> GetChangeCardsAsync(CancellationToken ct);
    /// <summary>Commits one diffed node to git; throws when the commit fails.</summary>
    Task AcceptAsync(string nodeId, CancellationToken ct);
}

public enum DiffLineKind { Context, Added, Removed }

public readonly record struct DiffLine(DiffLineKind Kind, string Text)
{
    public string Marker => Kind switch { DiffLineKind.Added => "+", DiffLineKind.Removed => "-", _ => " " };
}

/// <summary>A line diff (longest common subsequence) between the git-HEAD source and the disk source.</summary>
public static class LineDiff
{
    public static IReadOnlyList<DiffLine> Compute(string original, string proposed)
    {
        var a = Lines(original);
        var b = Lines(proposed);
        var lcs = new int[a.Length + 1, b.Length + 1];
        for (var i = a.Length - 1; i >= 0; i--)
            for (var j = b.Length - 1; j >= 0; j--)
                lcs[i, j] = a[i] == b[j] ? lcs[i + 1, j + 1] + 1 : Math.Max(lcs[i + 1, j], lcs[i, j + 1]);
        var result = new List<DiffLine>();
        int x = 0, y = 0;
        while (x < a.Length && y < b.Length)
        {
            if (a[x] == b[y]) { result.Add(new DiffLine(DiffLineKind.Context, a[x])); x++; y++; }
            else if (lcs[x + 1, y] >= lcs[x, y + 1]) result.Add(new DiffLine(DiffLineKind.Removed, a[x++]));
            else result.Add(new DiffLine(DiffLineKind.Added, b[y++]));
        }
        while (x < a.Length) result.Add(new DiffLine(DiffLineKind.Removed, a[x++]));
        while (y < b.Length) result.Add(new DiffLine(DiffLineKind.Added, b[y++]));
        return result;
    }

    private static string[] Lines(string text) =>
        text.Length == 0 ? [] : text.Replace("\r\n", "\n").TrimEnd('\n').Split('\n');
}
