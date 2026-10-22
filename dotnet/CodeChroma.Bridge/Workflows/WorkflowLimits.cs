namespace CodeChroma.Bridge.Workflows;

/// <summary>When a continue chain gets an amber warning, and the model context windows the ratio is measured against.</summary>
public static class WorkflowLimits
{
    public const int ChainWarnSteps = 3;
    public const double ContextWarnRatio = 0.6;
    public const long DefaultContextWindow = 200_000;

    /// <summary>Model-name markers with a larger window than the default; the first match wins.</summary>
    private static readonly (string Marker, long Window)[] Windows = [("[1m]", 1_000_000), ("-1m", 1_000_000)];

    public static long ContextWindow(string? model) =>
        model is not null && Windows.Where(w => model.Contains(w.Marker, StringComparison.OrdinalIgnoreCase)).Select(w => w.Window).FirstOrDefault() is > 0 and var window
            ? window
            : DefaultContextWindow;

    /// <summary>A chain of <see cref="ChainWarnSteps"/> or more steps, or a context at <see cref="ContextWarnRatio"/> of the window or more.</summary>
    public static bool ChainWarning(int chainLength, StepUsage? usage) =>
        chainLength >= ChainWarnSteps || (usage is { ContextWindow: > 0 } u && (double)u.ContextTokens / u.ContextWindow >= ContextWarnRatio);
}
