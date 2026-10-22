using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Agents;

/// <summary>The full-screen usage strip's numbers for one agent's claude session, read from its transcript.</summary>
public static class AgentUsage
{
    /// <summary>Null for a non-claude agent, one with no session yet, or a session with no billed reply.</summary>
    public static JsonObject? Read(AgentRecord record, string? sessionId, string? projectsRoot = null)
    {
        if (record.Kind != AgentRecord.DefaultKind || string.IsNullOrEmpty(sessionId)) return null;
        return Transcripts.ReadSession(sessionId, record.Worktree, projectsRoot) is { } session ? Payload(session.Last, session.Totals) : null;
    }

    /// <summary>Context from the last main-thread reply; tokens, cache hit and cost summed over every reply.</summary>
    public static JsonObject? Payload(TranscriptUsage? last, IReadOnlyDictionary<string, TokenCounts>? totals)
    {
        if (last is null && totals is not { Count: > 0 }) return null;
        var sum = totals?.Values.Aggregate(new TokenCounts(0, 0, 0, 0), (a, b) => a + b) ?? new TokenCounts(0, 0, 0, 0);
        var input = sum.Input + sum.CacheRead + sum.CacheWrite;
        var cost = totals is { Count: > 0 } ? ModelSpecs.Cost(totals) : null;
        return new JsonObject
        {
            ["contextTokens"] = last?.ContextTokens ?? 0,
            ["contextWindow"] = ModelSpecs.ContextWindow(last?.Model),
            ["inputTokens"] = input,
            ["outputTokens"] = sum.Output,
            ["cacheReadTokens"] = sum.CacheRead,
            ["cacheHitRatio"] = input > 0 ? Math.Round((double)sum.CacheRead / input, 4) : 0,
            ["costUsd"] = cost is { } usd ? JsonValue.Create(Math.Round(usd, 4)) : null,
            ["model"] = last?.Model,
        };
    }
}
