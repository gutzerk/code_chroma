using CodeChroma.Bridge.Agents;

namespace CodeChroma.Bridge.Workflows;

/// <summary>USD per million tokens for one model: uncached input, output, cache read and 5-minute cache write.</summary>
public sealed record ModelPrice(decimal Input, decimal Output, decimal CacheRead, decimal CacheWrite);

/// <summary>First-party API list prices per model, beside <see cref="WorkflowLimits"/>'s context windows; unknown models have no price.</summary>
public static class ModelPrices
{
    /// <summary>Model ids; a dated snapshot ("-20260101" or "@20260101") of one prices the same.</summary>
    private static readonly (string Prefix, ModelPrice Price)[] Table =
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

    public static ModelPrice? For(string? model)
    {
        if (string.IsNullOrEmpty(model)) return null;
        var id = model.Replace("[1m]", "", StringComparison.OrdinalIgnoreCase).Trim();
        foreach (var (prefix, price) in Table)
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
            if (For(model) is not { } price) return null;
            total += (counts.Input * price.Input + counts.Output * price.Output + counts.CacheRead * price.CacheRead + counts.CacheWrite * price.CacheWrite) / 1_000_000m;
        }
        return total;
    }

    private static bool IsDateSuffix(string id, int at) =>
        id.Length == at + 9 && id[at] is '-' or '@' && id[(at + 1)..].All(char.IsDigit);
}
