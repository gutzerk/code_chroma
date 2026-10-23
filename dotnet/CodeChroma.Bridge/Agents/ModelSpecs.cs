namespace CodeChroma.Bridge.Agents;

/// <summary>USD per million tokens for one model: uncached input, output, cache read and 5-minute cache write.</summary>
public sealed record ModelPrice(decimal Input, decimal Output, decimal CacheRead, decimal CacheWrite);

/// <summary>Per-model facts read from a model id: context window and first-party API list price; unknown models get the default window and no price.</summary>
public static class ModelSpecs
{
    public const long DefaultContextWindow = 200_000;
    public const long LongContextWindow = 1_000_000;
    private const string LongContextSuffix = "[1m]";

    /// <summary>Model ids; a dated snapshot ("-20260101" or "@20260101") of one prices the same.</summary>
    private static readonly (string Prefix, ModelPrice Price)[] Prices =
    [
        ("claude-fable-5-1", new(10m, 50m, 0.25m, 12.5m)),
        ("claude-mythos-5-1", new(10m, 50m, 0.25m, 12.5m)),
        ("claude-sonnet-5-5", new(2m, 10m, 0.2m, 2.5m)),
        ("claude-sonnet-4-6", new(3m, 15m, 0.3m, 3.75m)),
        ("claude-haiku-5-5", new(0.1m, 0.5m, 0.01m, 0.125m)),
        ("claude-haiku-4-5", new(1m, 5m, 0.1m, 1.25m)),
        ("claude-opus-5-5", new(4m, 20m, 0.2m, 5m)),
        ("claude-opus-4-8", new(5m, 25m, 0.5m, 6.25m)),
        ("claude-opus-4-7", new(5m, 25m, 0.5m, 6.25m)),
        ("claude-opus-4-6", new(5m, 25m, 0.5m, 6.25m)),
        ("claude-fable-5", new(10m, 50m, 1m, 12.5m)),
        ("claude-sonnet-5", new(2m, 10m, 0.2m, 2.5m)),
        ("claude-opus-5", new(5m, 25m, 0.5m, 6.25m)),
    ];

    /// <summary>The base id (no "[1m]" suffix, trimmed) and whether the id asked for the long context window.</summary>
    private static (string Id, bool LongContext) Parse(string model)
    {
        var id = model.Trim();
        var longContext = id.EndsWith(LongContextSuffix, StringComparison.OrdinalIgnoreCase);
        return (longContext ? id[..^LongContextSuffix.Length].Trim() : id, longContext);
    }

    public static long ContextWindow(string? model) =>
        !string.IsNullOrEmpty(model) && Parse(model).LongContext ? LongContextWindow : DefaultContextWindow;

    /// <summary>The window for a model id, widened to the long one when the context already outgrew the default (transcripts drop the "[1m]" suffix).</summary>
    public static long ContextWindow(string? model, long contextTokens) =>
        contextTokens > DefaultContextWindow ? LongContextWindow : ContextWindow(model);

    public static ModelPrice? Price(string? model)
    {
        if (string.IsNullOrEmpty(model)) return null;
        var id = Parse(model).Id;
        foreach (var (prefix, price) in Prices)
            if (id.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) && (id.Length == prefix.Length || IsDateSuffix(id, prefix.Length)))
                return price;
        return null;
    }

    /// <summary>The summed USD cost of per-model token counts, or null when any model with tokens has no price.</summary>
    public static decimal? Cost(IReadOnlyDictionary<string, TokenCounts> byModel)
    {
        decimal total = 0;
        foreach (var (model, counts) in byModel)
        {
            if (Price(model) is not { } price) return null;
            total += (counts.Input * price.Input + counts.Output * price.Output + counts.CacheRead * price.CacheRead + counts.CacheWrite * price.CacheWrite) / 1_000_000m;
        }
        return total;
    }

    private static bool IsDateSuffix(string id, int at) =>
        id.Length == at + 9 && id[at] is '-' or '@' && id[(at + 1)..].All(char.IsDigit);
}
