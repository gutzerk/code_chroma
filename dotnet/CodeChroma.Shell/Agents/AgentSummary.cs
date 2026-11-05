using System.Text.Json;
using static CodeChroma.Shell.JsonFields;

namespace CodeChroma.Shell;

/// <summary>What a working agent is doing right now (PreToolUse tool + short target, turn start).</summary>
public sealed record AgentActivity(string? Tool, string? Target, DateTimeOffset? TurnStartedAt);

/// <summary>A permission prompt the agent is waiting on; answerable from the shell via the page.</summary>
public sealed record AgentPermission(string RequestId, string? Tool, string? Summary, DateTimeOffset? At);

/// <summary>One agent row of a page's agent-summary message.</summary>
public sealed record AgentEntry(
    string Id,
    string Title,
    string Status,
    string? Worktree,
    string? WorktreeTitle,
    AgentActivity? Activity,
    AgentPermission? PendingPermission,
    DateTimeOffset? StatusSince);

/// <summary>The agent list a canvas page reports for its project (see the desktop channel contract); legacy top/count fields are ignored.</summary>
public sealed record AgentSummary(IReadOnlyList<AgentEntry> Agents)
{
    public bool Equals(AgentSummary? other) => other is not null && Agents.SequenceEqual(other.Agents);

    public override int GetHashCode() => Agents.Count;

    /// <summary>At most this many agents are kept from one report; the popover is a plain, non-virtualized list.</summary>
    public const int MaxAgents = 50;

    /// <summary>Longest string kept from a report: display text is clipped, longer ids drop the row (or the permission).</summary>
    public const int MaxText = 200;

    public static AgentSummary Parse(JsonElement root)
    {
        var agents = new List<AgentEntry>();
        if (root.TryGetProperty("agents", out var list) && list.ValueKind == JsonValueKind.Array)
            foreach (var item in list.EnumerateArray())
            {
                if (agents.Count == MaxAgents) break;
                if (Entry(item) is { } entry) agents.Add(entry);
            }
        return new AgentSummary(agents);
    }

    private static AgentEntry? Entry(JsonElement item)
    {
        if (item.ValueKind != JsonValueKind.Object || Id(item, "id") is not { } id || Clip(item, "status") is not { } status) return null;
        var activity = item.TryGetProperty("activity", out var a) && a.ValueKind == JsonValueKind.Object
            ? new AgentActivity(Clip(a, "tool"), Clip(a, "target"), Time(a, "turn_started_at"))
            : null;
        var permission = item.TryGetProperty("pending_permission", out var p) && p.ValueKind == JsonValueKind.Object && Id(p, "request_id") is { } requestId
            ? new AgentPermission(requestId, Clip(p, "tool"), Clip(p, "summary"), Time(p, "at"))
            : null;
        return new AgentEntry(id, Clip(item, "title") ?? id, status, Clip(item, "worktree"), Clip(item, "worktree_title"), activity, permission, Time(item, "status_since"));
    }

    private static string? Id(JsonElement root, string name) => Text(root, name) is { Length: <= MaxText } id ? id : null;

    private static string? Clip(JsonElement root, string name)
    {
        var text = Text(root, name);
        return text is { Length: > MaxText } ? text[..MaxText] : text;
    }
}
