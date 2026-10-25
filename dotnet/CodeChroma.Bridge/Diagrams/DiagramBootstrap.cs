using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;
using CoreContextDigest = CodeChroma.Core.ContextDigest;

namespace CodeChroma.Bridge.Diagrams;

/// <summary>Writes the first-open c1 (deterministic) and patterns (one model call) diagrams when missing; a read-only workspace never generates.</summary>
public sealed class DiagramBootstrap(Func<(ILlmCompletion? Provider, string Model)> quick)
{
    /// <summary>The bootstrap with no model access: c1 still gets its deterministic draft, patterns is never written.</summary>
    public static DiagramBootstrap Offline { get; } = new(() => (null, BridgeLimits.PatternsGeneratorModel));

    public void IfMissing(Workspace ws)
    {
        if (ws.ReadOnly) return;
        Guarded("c1", () => C1(ws));
        Guarded("patterns", () => Patterns(ws));
    }

    private static void Guarded(string kind, Action bootstrap)
    {
        // A failed bootstrap must never fail the analyze that triggered it.
        try { bootstrap(); }
        catch (Exception error) { Console.Error.WriteLine($"{kind}: bootstrap generation failed: {error.Message}"); }
    }

    private static void C1(Workspace ws)
    {
        var path = ws.DiagramPath("c1");
        if (File.Exists(path)) return;
        // An engine without a graph snapshot still gets the repo-name system node, like an empty Python graph.
        var graph = ws.Engine.GraphSnapshot() ?? new CodeChroma.Core.Graph([], []);
        JsonFile.Write(path, C1Template.Generate(CoreContextDigest.Build(graph, ws.Root)));
    }

    private void Patterns(Workspace ws)
    {
        var path = ws.DiagramPath("patterns");
        if (File.Exists(path)) return;
        var (provider, model) = quick();
        if (provider is null) return;
        var candidates = ws.Engine.PatternCandidates();
        if (candidates.Count == 0) return;
        if (PatternsGenerator.Generate(candidates, provider, model).GetAwaiter().GetResult() is { } diagram) JsonFile.Write(path, diagram);
    }
}
