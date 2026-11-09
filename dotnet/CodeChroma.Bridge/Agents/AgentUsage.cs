using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Agents;

/// <summary>The full-screen usage strip's numbers for one agent's claude session, read from its transcript.</summary>
public static class AgentUsage
{
    /// <summary>Null for an agent with no claude session, one with no session yet, or a session with no billed reply; `sessionOf` runs only when a claude session backs the agent.</summary>
    public static JsonObject? Read(AgentRecord record, Func<string?> sessionOf, string? projectsRoot = null, string? catalogDir = null)
    {
        var sessionId = record.HasClaudeSession ? sessionOf() : null;
        if (string.IsNullOrEmpty(sessionId)) return null;
        return Transcripts.ReadSession(sessionId, record.Worktree, projectsRoot) is { } session ? Payload(session.Last, session.Total, catalogDir) : null;
    }

    /// <summary>Context from the last main-thread reply; tokens and cache hit summed over every reply.</summary>
    private static JsonObject? Payload(TranscriptUsage? last, TokenCounts total, string? catalogDir)
    {
        if (last is null && total == TokenCounts.Zero) return null;
        var input = total.Input + total.CacheRead + total.CacheWrite;
        return new JsonObject
        {
            ["contextTokens"] = last?.ContextTokens ?? 0,
            ["contextWindow"] = ModelSpecs.ContextWindow(last?.Model, last?.ContextTokens ?? 0, catalogDir),
            ["inputTokens"] = input,
            ["outputTokens"] = total.Output,
            ["cacheReadTokens"] = total.CacheRead,
            ["cacheHitRatio"] = input > 0 ? Math.Round((double)total.CacheRead / input, 4) : 0,
            ["model"] = last?.Model,
        };
    }
}
