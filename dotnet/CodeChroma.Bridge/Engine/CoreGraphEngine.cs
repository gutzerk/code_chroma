using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using CodeChroma.Core;
using CodeChroma.Core.Analyzers;
using CodeChroma.Core.Patterns;

namespace CodeChroma.Bridge.Engine;

/// <summary>Produces the graph core's analyzer-output contract (the C# analyzers by default, Python as the oracle).</summary>
public interface IAnalysisExporter
{
    AnalysisInput Full(string root);

    AnalysisDelta Delta(string root, IReadOnlyList<string> changedPaths);
}

/// <summary>The wire shape of `python -m codechroma.analysis_export --files`.</summary>
internal sealed record DeltaWire(
    IReadOnlyList<FileSymbols> Changed,
    IReadOnlyList<string> Removed,
    [property: JsonPropertyName("import_resolutions")] IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> ImportResolutions);

/// <summary>Analyzes in-process with the C# tree-sitter analyzers; no Python interpreter involved.</summary>
public sealed class NativeAnalysisExporter(AnalysisExporter? exporter = null) : IAnalysisExporter
{
    private readonly AnalysisExporter _exporter = exporter ?? new AnalysisExporter();

    public AnalyzerRegistry Registry => _exporter.Registry;

    public AnalysisInput Full(string root) => _exporter.Full(root);

    public AnalysisDelta Delta(string root, IReadOnlyList<string> changedPaths) => _exporter.Delta(root, changedPaths);
}

/// <summary>Picks the analyzer backend: CODECHROMA_ANALYZERS=python shells out to Python, anything else is native C#.</summary>
public static class AnalysisExporters
{
    public const string BackendEnvVar = "CODECHROMA_ANALYZERS";

    public static IAnalysisExporter FromEnvironment() => For(Environment.GetEnvironmentVariable(BackendEnvVar));

    public static IAnalysisExporter For(string? backend) =>
        string.Equals(backend, "python", StringComparison.OrdinalIgnoreCase)
            ? new PythonAnalysisExporter()
            : new NativeAnalysisExporter();
}

/// <summary>Shells out to the Python analyzers (`codechroma.analysis_export`); CODECHROMA_PYTHON picks the interpreter.</summary>
public sealed class PythonAnalysisExporter(string? python = null) : IAnalysisExporter
{
    public const string PythonEnvVar = "CODECHROMA_PYTHON";
    private const int TimeoutSeconds = 600;

    private readonly string _python = python
        ?? Environment.GetEnvironmentVariable(PythonEnvVar)
        ?? (OperatingSystem.IsWindows() ? "python" : "python3");

    public AnalysisInput Full(string root) => AnalysisInputReader.Parse(Run(root, []));

    public AnalysisDelta Delta(string root, IReadOnlyList<string> changedPaths)
    {
        var wire = JsonSerializer.Deserialize<DeltaWire>(Run(root, ["--files", .. changedPaths]), WireJson.Options)
            ?? throw new JsonException("analysis delta is empty");
        return new AnalysisDelta(wire.Changed, wire.Removed, wire.ImportResolutions);
    }

    private string Run(string root, IEnumerable<string> extra)
    {
        var info = new ProcessStartInfo(_python)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
            WorkingDirectory = root,
        };
        foreach (var arg in new[] { "-m", "codechroma.analysis_export", root }.Concat(extra)) info.ArgumentList.Add(arg);
        info.Environment["PYTHONIOENCODING"] = "utf-8";
        using var process = Process.Start(info) ?? throw new InvalidOperationException($"could not start {_python}");
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        if (!process.WaitForExit(TimeSpan.FromSeconds(TimeoutSeconds)))
        {
            try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
            throw new TimeoutException($"{_python} -m codechroma.analysis_export timed out after {TimeoutSeconds}s");
        }
        if (process.ExitCode != 0)
            throw new InvalidOperationException($"analysis export failed ({process.ExitCode}): {stderr.GetAwaiter().GetResult().Trim()}");
        return stdout.GetAwaiter().GetResult();
    }
}

/// <summary>The bridge's engine seam over <see cref="GraphCore"/>.</summary>
public sealed class CoreGraphEngine : IGraphEngine
{
    private readonly GraphCore _core;
    private readonly IAnalysisExporter _exporter;
    private readonly string _root;
    private readonly object _writeLock = new();
    private IReadOnlyList<PatternInstance>? _patterns;
    private IReadOnlyDictionary<string, ClassShape>? _shapes;

    public CoreGraphEngine(string root, IAnalysisExporter exporter)
    {
        _root = root;
        _exporter = exporter;
        _core = new GraphCore(liveResolver: exporter is NativeAnalysisExporter native ? new LiveImportResolver(native.Registry, root) : null);
        _core.Analyze(exporter.Full(root));
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
        }
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
}
