using CodeChroma.Core;
using CodeChroma.Core.Analyzers;
using CodeChroma.Core.Patterns;

namespace CodeChroma.Bridge.Engine;

/// <summary>Produces the graph core's analyzer-output contract (the bridge ships the native C# analyzers; tests can swap in the Python oracle).</summary>
public interface IAnalysisExporter
{
    AnalysisInput Full(string root);

    AnalysisDelta Delta(string root, IReadOnlyList<string> changedPaths);
}

/// <summary>Analyzes in-process with the C# tree-sitter analyzers; no Python interpreter involved.</summary>
public sealed class NativeAnalysisExporter(AnalysisExporter? exporter = null) : IAnalysisExporter
{
    private readonly AnalysisExporter _exporter = exporter ?? new AnalysisExporter();

    public AnalyzerRegistry Registry => _exporter.Registry;

    public AnalysisInput Full(string root) => _exporter.Full(root);

    public AnalysisDelta Delta(string root, IReadOnlyList<string> changedPaths) => _exporter.Delta(root, changedPaths);
}

/// <summary>The bridge's engine seam over <see cref="GraphCore"/>.</summary>
public sealed class CoreGraphEngine : IGraphEngine
{
    private readonly GraphCore _core;
    private readonly IAnalysisExporter _exporter;
    private readonly string _root;
    private readonly bool _writeDigest;
    private readonly object _writeLock = new();
    private IReadOnlyList<PatternInstance>? _patterns;
    private IReadOnlyDictionary<string, ClassShape>? _shapes;

    public CoreGraphEngine(string root, IAnalysisExporter exporter, bool writeDigest = true)
    {
        _root = root;
        _writeDigest = writeDigest;
        _exporter = exporter;
        _core = new GraphCore(liveResolver: exporter is NativeAnalysisExporter native ? new LiveImportResolver(native.Registry, root) : null);
        _core.Analyze(exporter.Full(root));
        WriteDigest();
    }

    /// <summary>Wraps an already-built analysis input (tests and snapshots); reanalysis needs an exporter.</summary>
    public CoreGraphEngine(AnalysisInput input, IAnalysisExporter? exporter = null)
    {
        _root = "";
        _exporter = exporter ?? new NoReanalysis();
        _core = new GraphCore();
        _core.Analyze(input);
    }

    public GraphNode? GetNode(string id) => _core.GetNode(id) is { } node ? Map(node) : null;

    public IReadOnlyList<GraphNode> GetChildren(string id) => _core.GetChildren(id).Select(Map).ToList();

    public SymbolInfo? GetSymbol(string id) =>
        _core.Snapshot.Symbols.TryGetValue(id, out var s) ? new SymbolInfo(s.Id, s.FilePath, s.StartLine, s.EndLine, s.Language, s.QualifiedName) : null;

    public IReadOnlyList<GraphNode> GetDependencies(string id) => _core.GetDependencies(id).Select(Map).ToList();

    public IReadOnlyList<GraphNode> GetDependents(string id) => _core.GetDependents(id).Select(Map).ToList();

    public string? SummaryText(string id) => _core.Snapshot.Summaries.GetValueOrDefault(id);

    public string? FunctionNodeAtLine(string relPath, int line)
    {
        // Same walk as the trace FrameMapper: entries sorted by (start, -end), nearest start at or before the line that covers it.
        var entries = _core.Snapshot.SymbolList
            .Where(s => s.Kind == SymbolKind.Function && s.FilePath == relPath)
            .OrderBy(s => s.StartLine).ThenByDescending(s => s.EndLine).ToList();
        for (var i = entries.Count - 1; i >= 0; i--)
        {
            if (entries[i].StartLine > line) continue;
            if (line <= entries[i].EndLine) return entries[i].Id;
        }
        return null;
    }

    public void Reanalyze(IReadOnlyList<string> changedPaths)
    {
        lock (_writeLock)
        {
            _core.Reanalyze(_exporter.Delta(_root, changedPaths));
            _patterns = null;
            WriteDigest();
        }
    }

    private void WriteDigest()
    {
        if (_root.Length == 0 || !_writeDigest) return;
        try { DependencyDigest.Write(_root, DependencyDigest.Build(_core.Snapshot)); }
        catch (Exception ex) { Console.Error.WriteLine($"dependency digest build/write failed for {_root}: {ex.Message}"); }
    }

    public CodeChroma.Core.Graph? GraphSnapshot() => _core.Snapshot;

    public CodeChroma.Core.ClusterResult? BuildClusters(string repoRoot) =>
        CodeChroma.Core.Clustering.Build(_core.Snapshot, new LiveImportResolver(AnalyzerRegistry.WithDefaults(), repoRoot));

    public IReadOnlyList<PatternInstance> PatternCandidates() => PatternState().Candidates;

    public System.Text.Json.Nodes.JsonObject? PatternsContext()
    {
        var (graph, shapes, candidates) = PatternState();
        return Core.Patterns.PatternsContext.Build(graph, shapes, candidates);
    }

    private (Graph Graph, IReadOnlyDictionary<string, ClassShape> Shapes, IReadOnlyList<PatternInstance> Candidates) PatternState()
    {
        lock (_writeLock)
        {
            var graph = _core.Snapshot;
            if (_patterns is null)
            {
                var paths = graph.SymbolList.Where(s => s.Kind == SymbolKind.Module).Select(s => s.FilePath);
                _shapes = _root.Length == 0 ? new Dictionary<string, ClassShape>() : ClassShapeExtractor.ExtractAll(_root, paths);
                _patterns = PatternDetector.DetectCandidates(graph, _shapes);
            }
            return (graph, _shapes!, _patterns);
        }
    }

    private static GraphNode Map(HierarchyNode node) => new(
        node.Id, node.Name, (HierarchyLevel)(int)node.Level, node.ParentIds, node.SourcePath, node.DocOnly, node.DependsOnIds, node.SymbolIds);

    private sealed class NoReanalysis : IAnalysisExporter
    {
        public AnalysisInput Full(string root) => throw new NotSupportedException();

        public AnalysisDelta Delta(string root, IReadOnlyList<string> changedPaths) =>
            throw new NotSupportedException("this engine was built from a fixed input");
    }
}

/// <summary>Analyzes a root with the configured analyzers and serves the graph from the C# core.</summary>
public sealed class CoreEngineFactory(IAnalysisExporter exporter) : IEngineFactory
{
    public IGraphEngine Create(string root) => new CoreGraphEngine(root, exporter);

    public IGraphEngine Create(string root, bool readOnly) => new CoreGraphEngine(root, exporter, writeDigest: !readOnly);
}
