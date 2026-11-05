using System.Text.Json;

namespace CodeChroma.Shell;

/// <summary>What a project tab shows: the status dot (null = nothing) and the badge number (0 = no badge).</summary>
public sealed record TabBadge(string? Dot, int Count)
{
    public static readonly TabBadge None = new(null, 0);
}

/// <summary>A blocked agent and the tab whose page reported it.</summary>
public sealed record BlockedAgent(string TabId, AgentEntry Agent);

/// <summary>Pure roll-up rules shared by the tab strip, the pill and the hover popover.</summary>
public static class AgentRollup
{
    private static readonly string[] Priority = ["blocked", "error", "done", "working"];

    public static string? Top(IEnumerable<AgentEntry> agents)
    {
        var statuses = agents.Select(a => a.Status).ToHashSet();
        return Priority.FirstOrDefault(statuses.Contains);
    }

    public static TabBadge Badge(AgentSummary? summary, bool active)
    {
        if (summary is null || Top(summary.Agents) is not { } top) return TabBadge.None;
        var counted = active ? new[] { "blocked", "error" } : ["blocked", "error", "done"];
        var count = top == "working" ? 0 : summary.Agents.Count(a => counted.Contains(a.Status));
        return new TabBadge(top, count);
    }

    public static string Counts(AgentSummary summary)
    {
        var agents = summary.Agents.Count(a => a.Status != "stopped");
        var worktrees = summary.Agents.Select(a => a.Worktree).Where(w => w is not null).Distinct().Count();
        return $"{agents} {Plural(agents, "agent", "agents")} · {worktrees} {Plural(worktrees, "worktree", "worktrees")}";
    }

    public static string Plural(int n, string one, string many) => n == 1 ? one : many;

    public static string Clock(TimeSpan elapsed)
    {
        if (elapsed < TimeSpan.Zero) elapsed = TimeSpan.Zero;
        return elapsed.TotalHours >= 1 ? $"{(int)elapsed.TotalHours}:{elapsed.Minutes:00}:{elapsed.Seconds:00}" : $"{elapsed.Minutes}:{elapsed.Seconds:00}";
    }

    public static string Waiting(TimeSpan elapsed) =>
        elapsed.TotalMinutes < 1 ? "<1 min" : elapsed.TotalHours < 1 ? $"{(int)elapsed.TotalMinutes} min" : $"{(int)elapsed.TotalHours} h";
}

/// <summary>The JSON commands the shell sends to a page through window.__ccAgentCommand.</summary>
public static class AgentCommand
{
    public static string Select(string agentId) =>
        JsonSerializer.Serialize(new Dictionary<string, string> { ["type"] = "select-agent", ["id"] = agentId });

    public static string Allow(string agentId, string requestId) =>
        JsonSerializer.Serialize(new Dictionary<string, string> { ["type"] = "permission", ["id"] = agentId, ["request_id"] = requestId, ["decision"] = "allow" });
}

/// <summary>Agent summaries per tab plus the round-robin cursor of the "N waiting" pill.</summary>
public sealed class AgentBoard
{
    private readonly Dictionary<string, AgentSummary> byTab = [];
    private (string TabId, string AgentId, DateTimeOffset Since)? cursor;

    public AgentSummary? For(string tabId) => byTab.GetValueOrDefault(tabId);

    public bool Report(string tabId, AgentSummary summary)
    {
        if (byTab.TryGetValue(tabId, out var current) && current.Equals(summary)) return false;
        byTab[tabId] = summary;
        return true;
    }

    public bool Forget(string tabId) => byTab.Remove(tabId);

    public IReadOnlyList<BlockedAgent> Blocked(IReadOnlyList<(string TabId, string RootId)> order)
    {
        var seen = new HashSet<(string, string)>();
        var found = new List<(BlockedAgent Agent, int Index)>();
        for (var i = 0; i < order.Count; i++)
        {
            if (!byTab.TryGetValue(order[i].TabId, out var summary)) continue;
            foreach (var agent in summary.Agents.Where(a => a.Status == "blocked"))
                if (seen.Add((order[i].RootId, agent.Id))) found.Add((new BlockedAgent(order[i].TabId, agent), i));
        }
        return [.. found
            .OrderBy(f => f.Agent.Agent.StatusSince ?? DateTimeOffset.MaxValue)
            .ThenBy(f => f.Index)
            .ThenBy(f => f.Agent.Agent.Id, StringComparer.Ordinal)
            .Select(f => f.Agent)];
    }

    public BlockedAgent? Next(IReadOnlyList<(string TabId, string RootId)> order)
    {
        var blocked = Blocked(order);
        if (blocked.Count == 0) return null;
        var next = blocked[NextIndex(blocked)];
        cursor = (next.TabId, next.Agent.Id, next.Agent.StatusSince ?? DateTimeOffset.MaxValue);
        return next;
    }

    private int NextIndex(IReadOnlyList<BlockedAgent> blocked)
    {
        if (cursor is not { } last) return 0;
        for (var i = 0; i < blocked.Count; i++)
            if (blocked[i].TabId == last.TabId && blocked[i].Agent.Id == last.AgentId) return (i + 1) % blocked.Count;
        for (var i = 0; i < blocked.Count; i++)
            if ((blocked[i].Agent.StatusSince ?? DateTimeOffset.MaxValue) > last.Since) return i;
        return 0;
    }
}
