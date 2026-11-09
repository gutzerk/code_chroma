namespace CodeChroma.Bridge.Agents;

/// <summary>Per-model facts read from a model id: its context window.</summary>
public static class ModelSpecs
{
    public const long DefaultContextWindow = 200_000;
    public const long LongContextWindow = 1_000_000;

    /// <summary>Fallback when Claude Code's catalog is not cached: these older models (and every claude-3*) read 200k, every other id 1M.</summary>
    private static readonly HashSet<string> DefaultWindowModels = new(StringComparer.OrdinalIgnoreCase)
    {
        "claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-5", "claude-opus-4-1", "claude-opus-4", "claude-sonnet-4",
    };

    /// <summary>The model's window from Claude Code's cached catalog, else the fallback; widened to 1M once the context outgrew it.</summary>
    public static long ContextWindow(string? model, long contextTokens = 0, string? catalogDir = null)
    {
        var window = string.IsNullOrWhiteSpace(model) ? DefaultContextWindow : Lookup(ClaudeModelCatalog.BaseId(model), catalogDir ?? ClaudeModelCatalog.DefaultDir());
        return contextTokens > window ? LongContextWindow : window;
    }

    private static long Lookup(string id, string catalogDir) =>
        ClaudeModelCatalog.MaxInputTokens(id, catalogDir)
        ?? (DefaultWindowModels.Contains(id) || id.StartsWith("claude-3", StringComparison.OrdinalIgnoreCase) ? DefaultContextWindow : LongContextWindow);
}
