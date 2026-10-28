using System.Collections.Concurrent;
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

    private readonly ConcurrentDictionary<string, byte> _attempted = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Writes the missing diagrams before returning (c1, then the model call for patterns).</summary>
    public void IfMissing(Workspace ws)
    {
        if (ws.ReadOnly) return;
        Guarded("system-context", () => C1(ws));
        Guarded("patterns", () => Patterns(ws));
    }

    /// <summary>Writes c1 now and patterns in the background, so a slow model call never holds up opening the workspace.</summary>
    public void Start(Workspace ws)
    {
        if (ws.ReadOnly) return;
        Guarded("system-context", () => C1(ws));
        _ = Task.Run(() => Guarded("patterns", () => Patterns(ws)));
    }

    private static void Guarded(string kind, Action bootstrap)
    {
        // A failed bootstrap must never fail the analyze that triggered it.
        try { bootstrap(); }
        catch (Exception error) { Console.Error.WriteLine($"{kind}: bootstrap generation failed: {error.Message}"); }
    }

    private static void C1(Workspace ws)
    {
        var path = ws.DiagramPath("system-context");
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
        // One attempt per process: a failing model must not be re-billed on every workspace reload.
        if (!_attempted.TryAdd(path, 0)) return;
        var candidates = ws.Engine.PatternCandidates();
        if (candidates.Count == 0) return;
        if (PatternsGenerator.Generate(candidates, provider, model).GetAwaiter().GetResult() is { } diagram) JsonFile.Write(path, diagram);
    }
}
