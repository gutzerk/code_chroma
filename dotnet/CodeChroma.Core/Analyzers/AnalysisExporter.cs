using System.Text;

namespace CodeChroma.Core.Analyzers;

/// <summary>Produces the analyzer-output contract in-process; the C# replacement for `python -m codechroma.analysis_export`.</summary>
public sealed class AnalysisExporter(AnalyzerRegistry? registry = null)
{
    private const int WorkerStackBytes = 256 * 1024 * 1024;

    private readonly AnalyzerRegistry _registry = registry ?? AnalyzerRegistry.WithDefaults();

    public AnalyzerRegistry Registry => _registry;

    /// <summary>The full analysis input for a repo, summaries computed offline.</summary>
    public AnalysisInput Full(string root)
    {
        root = Path.GetFullPath(root);
        var parsed = ParseFiles(root, RepoScanner.ListFiles(root));
        var resolutions = ImportResolutions(parsed, root);
        return new AnalysisInput
        {
            SchemaVersion = AnalysisInputReader.SupportedSchemaVersion,
            Files = parsed,
            ImportResolutions = resolutions,
            Summaries = OfflineSummaries(parsed, resolutions),
        };
    }

    /// <summary>Changed files re-parsed, vanished files listed as removed, plus their import resolutions.</summary>
    public AnalysisDelta Delta(string root, IReadOnlyList<string> changedPaths)
    {
        root = Path.GetFullPath(root);
        var normalized = changedPaths.Select(p => p.Replace('\\', '/')).ToList();
        var present = normalized.Where(p => Exists(root, p)).ToList();
        var removed = normalized.Where(p => !Exists(root, p)).ToList();
        var parsed = ParseFiles(root, present);
        return new AnalysisDelta(parsed, removed, ImportResolutions(parsed, root));
    }

    private static bool Exists(string root, string rel)
    {
        var full = Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar));
        return File.Exists(full) || Directory.Exists(full);
    }

    /// <summary>Mirrors GraphEngine.analyze(): no analyzer or a parse failure means a null symbol list.</summary>
    public List<FileSymbols> ParseFiles(string root, IReadOnlyList<string> paths)
    {
        var results = new FileSymbols[paths.Count];
        RunOnBigStacks(paths.Count, i => results[i] = new FileSymbols(paths[i], ParseOne(root, paths[i])));
        return [.. results];
    }

    private IReadOnlyList<Symbol>? ParseOne(string root, string relPath)
    {
        var analyzer = _registry.ForFile(relPath);
        if (analyzer is null) return null;
        try
        {
            var bytes = File.ReadAllBytes(Path.Combine(root, relPath.Replace('/', Path.DirectorySeparatorChar)));
            return analyzer.Parse(relPath, Encoding.UTF8.GetString(bytes));
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>Runs the body for 0..count on worker threads with deep stacks (recursive tree walks need them).</summary>
    private static void RunOnBigStacks(int count, Action<int> body)
    {
        if (count == 0) return;
        var next = -1;
        var workers = Math.Min(Environment.ProcessorCount, count);
        var failures = new List<Exception>();
        var threads = Enumerable.Range(0, workers).Select(_ => new Thread(() =>
        {
            try
            {
                int i;
                while ((i = Interlocked.Increment(ref next)) < count) body(i);
            }
            catch (Exception e)
            {
                lock (failures) failures.Add(e);
            }
        }, WorkerStackBytes)).ToList();
        foreach (var t in threads) t.Start();
        foreach (var t in threads) t.Join();
        if (failures.Count > 0) throw new AggregateException(failures);
    }

    public Dictionary<string, IReadOnlyDictionary<string, string>> ImportResolutions(IReadOnlyList<FileSymbols> parsed, string root)
    {
        var resolutions = new Dictionary<string, IReadOnlyDictionary<string, string>>();
        foreach (var file in parsed)
        {
            var analyzer = _registry.ForFile(file.Path);
            if (analyzer is null) continue;
            foreach (var symbol in file.Symbols ?? [])
            {
                if (symbol.Kind != SymbolKind.Module) continue;
                foreach (var dotted in symbol.Imports.Values.Distinct().Order(StringComparer.Ordinal))
                {
                    var target = analyzer.ResolveImport(dotted, file.Path, root);
                    if (target is null) continue;
                    if (!resolutions.TryGetValue(file.Path, out var perFile))
                        resolutions[file.Path] = perFile = new Dictionary<string, string>();
                    ((Dictionary<string, string>)perFile)[dotted] = target;
                }
            }
        }
        return resolutions;
    }

    /// <summary>Node id to offline summary text, built exactly as the engine's summarize step does.</summary>
    public static Dictionary<string, string> OfflineSummaries(
        IReadOnlyList<FileSymbols> parsed, IReadOnlyDictionary<string, IReadOnlyDictionary<string, string>> resolutions)
    {
        var built = GraphBuilder.Build(parsed, new TableImportResolver(resolutions));
        var symbols = new Dictionary<string, Symbol>();
        foreach (var symbol in built.Symbols) symbols[symbol.Id] = symbol;
        var summaries = new Dictionary<string, string>();
        foreach (var node in built.Nodes) summaries[node.Id] = OfflineSummary(node, NodeContext(node, symbols));
        return summaries;
    }

    public static string LevelValue(HierarchyLevel level) => level switch
    {
        HierarchyLevel.LogicBlock => "logic_block",
        _ => level.ToString().ToLowerInvariant(),
    };

    public static string NodeContext(HierarchyNode node, IReadOnlyDictionary<string, Symbol> symbols)
    {
        var parts = new List<string> { $"level={LevelValue(node.Level)}" };
        if (!string.IsNullOrEmpty(node.SourcePath)) parts.Add($"source={node.SourcePath}");
        if (symbols.TryGetValue(node.Id, out var symbol))
        {
            if (symbol.References.Count > 0)
                parts.Add("calls=" + string.Join(", ", symbol.References.Distinct().Order(StringComparer.Ordinal).Take(10)));
            if (symbol.Imports.Count > 0)
                parts.Add("imports=" + string.Join(", ", symbol.Imports.Values.Distinct().Order(StringComparer.Ordinal).Take(10)));
        }
        return string.Join("; ", parts);
    }

    public static string OfflineSummary(HierarchyNode node, string context)
    {
        var label = LevelValue(node.Level).Replace('_', ' ');
        var capitalized = char.ToUpperInvariant(label[0]) + label[1..];
        return context.Length > 0 ? $"{capitalized} `{node.Name}`: {context}" : $"{capitalized} `{node.Name}`.";
    }
}
