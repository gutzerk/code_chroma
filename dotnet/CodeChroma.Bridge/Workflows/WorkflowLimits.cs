namespace CodeChroma.Bridge.Workflows;

/// <summary>When a continue chain gets an amber warning; the window it is measured against comes from <see cref="Agents.ModelSpecs"/>.</summary>
public static class WorkflowLimits
{
    public const int ChainWarnSteps = 3;
    public const double ContextWarnRatio = 0.6;

    /// <summary>A chain past <see cref="ChainWarnSteps"/> steps, or a context past <see cref="ContextWarnRatio"/> of the window.</summary>
    public static bool ChainWarning(int chainLength, StepUsage? usage) =>
        chainLength > ChainWarnSteps || (usage is { ContextWindow: > 0 } u && (double)u.ContextTokens / u.ContextWindow > ContextWarnRatio);
}
