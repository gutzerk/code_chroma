using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace CodeChroma.Core;

/// <summary>Reverses every node's DependsOnIds once so "who calls this" is an O(1) lookup.</summary>
public sealed class DependencyIndex
{
    public const int RouteHopCap = 12;

    private readonly Graph _graph;
    private readonly Dictionary<string, List<string>> _dependents = [];
    private readonly Dictionary<string, List<string>> _dependencies = [];

    public DependencyIndex(Graph graph)
    {
        _graph = graph;
        foreach (var node in graph.NodeList)
        {
            var present = node.DependsOnIds.Where(graph.Nodes.ContainsKey).Order(StringComparer.Ordinal).ToList();
            if (present.Count > 0) _dependencies[node.Id] = present;
            foreach (var depId in present)
            {
                if (!_dependents.TryGetValue(depId, out var list)) _dependents[depId] = list = [];
                list.Add(node.Id);
            }
        }
        foreach (var list in _dependents.Values) list.Sort(StringComparer.Ordinal);
    }

    public IReadOnlyList<string> DependenciesOf(string nodeId) =>
        _dependencies.TryGetValue(nodeId, out var list) ? list : [];

    public IReadOnlyList<string> DependentsOf(string nodeId) =>
        _dependents.TryGetValue(nodeId, out var list) ? list : [];

    /// <summary>Dependency path between two nodes: callee direction first, then falling back to caller.</summary>
    public IReadOnlyList<string>? FindRoute(string fromId, string toId)
    {
        if (!_graph.Nodes.ContainsKey(fromId) || !_graph.Nodes.ContainsKey(toId)) return null;
        if (fromId == toId) return [fromId];
        return BfsPath(fromId, toId, DependenciesOf) ?? BfsPath(fromId, toId, DependentsOf);
    }

    /// <summary>Every resolved (from, to) edge exactly once.</summary>
    public IEnumerable<(string From, string To)> Edges()
    {
        foreach (var node in _graph.NodeList)
            foreach (var depId in node.DependsOnIds)
                if (_graph.Nodes.ContainsKey(depId)) yield return (node.Id, depId);
    }

    private static List<string>? BfsPath(string from, string to, Func<string, IReadOnlyList<string>> neighborsOf)
    {
        var parent = new Dictionary<string, string> { [from] = from };
        var depth = new Dictionary<string, int> { [from] = 0 };
        var queue = new Queue<string>([from]);
        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            if (depth[current] >= RouteHopCap) continue;
            foreach (var neighbor in neighborsOf(current))
            {
                if (parent.ContainsKey(neighbor)) continue;
                parent[neighbor] = current;
                depth[neighbor] = depth[current] + 1;
                if (neighbor == to) return Unwind(parent, from, to);
                queue.Enqueue(neighbor);
            }
        }
        return null;
    }

    private static List<string> Unwind(Dictionary<string, string> parent, string from, string to)
    {
        var path = new List<string> { to };
        for (var at = to; at != from;) path.Add(at = parent[at]);
        path.Reverse();
        return path;
    }
}

/// <summary>The capped file, class and function dependency digest, persisted to .codechroma/dependency-digest.json.</summary>
public static class DependencyDigest
{
    public const string FileName = "dependency-digest.json";

    /// <summary>One file's symbols grouped the way every per-file consumer (digest, wiki) reads them.</summary>
    public sealed class FileSymbolsView
    {
        public required string Path { get; init; }
        public Symbol? Module { get; init; }
        public List<Symbol> Variables { get; } = [];
        public List<Symbol> Classes { get; } = [];
        public Dictionary<string, List<Symbol>> MethodsByClassId { get; } = [];
        public List<Symbol> Functions { get; } = [];
    }

    public static JsonObject Build(Graph graph, DigestCaps? caps = null, DependencyIndex? index = null)
    {
        caps ??= new DigestCaps();
        index ??= new DependencyIndex(graph);
        var filesByPath = GroupByFile(graph);

        var ranked = filesByPath.Values
            .OrderByDescending(f => FileSignal(index, f)).ThenBy(f => f.Path, StringComparer.Ordinal).ToList();

        var detailed = new HashSet<string>();
        var remainingFiles = caps.MaxDetailedFiles;
        var remainingEntries = caps.MaxTotalSymbolEntries;
        var truncated = false;
        foreach (var file in ranked)
        {
            var entryCount = FileEntryCount(file, index, graph, caps);
            if (remainingFiles <= 0 || entryCount > remainingEntries)
            {
                truncated = true;
                continue;
            }
            detailed.Add(file.Path);
            remainingFiles--;
            remainingEntries -= entryCount;
        }

        var files = new JsonArray();
        foreach (var path in filesByPath.Keys.Order(StringComparer.Ordinal))
            files.Add(detailed.Contains(path)
                ? FileDetail(index, graph, filesByPath[path], caps)
                : BareFileEntry(filesByPath[path], graph));

        return new JsonObject
        {
            ["generated_at"] = DateTimeOffset.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.ffffffzzz"),
            ["totals"] = new JsonObject
            {
                ["file_count"] = filesByPath.Count,
                ["class_count"] = filesByPath.Values.Sum(f => f.Classes.Count),
                ["function_count"] = filesByPath.Values.Sum(f => f.Functions.Count + f.MethodsByClassId.Values.Sum(m => m.Count)),
                ["edge_count"] = index.Edges().Count(),
            },
            ["caps"] = new JsonObject
            {
                ["max_callees_per_symbol"] = caps.MaxCalleesPerSymbol,
                ["max_callers_per_symbol"] = caps.MaxCallersPerSymbol,
                ["max_imports_per_file"] = caps.MaxImportsPerFile,
                ["trivial_max_body_lines"] = caps.TrivialMaxBodyLines,
                ["max_detailed_files"] = caps.MaxDetailedFiles,
                ["max_total_symbol_entries"] = caps.MaxTotalSymbolEntries,
            },
            ["truncated"] = truncated,
            ["files_omitted"] = filesByPath.Count - detailed.Count,
            ["files"] = files,
        };
    }

    public static string PathFor(string repoRoot) => Path.Combine(repoRoot, ".codechroma", FileName);

    /// <summary>Tolerates a missing or malformed file, returning an empty object.</summary>
    public static JsonObject Load(string repoRoot)
    {
        try
        {
            return JsonNode.Parse(File.ReadAllText(PathFor(repoRoot), Encoding.UTF8)) as JsonObject ?? [];
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return [];
        }
    }

    /// <summary>Writes via a temp file and a rename so a reader never sees a half-written digest.</summary>
    public static void Write(string repoRoot, JsonObject digest)
    {
        var path = PathFor(repoRoot);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = $"{path}.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp";
        File.WriteAllText(temp, digest.ToJsonString(new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false));
        File.Move(temp, path, overwrite: true);
    }

    public static Dictionary<string, FileSymbolsView> GroupByFile(Graph graph)
    {
        var byFile = new OrderedMap<string, List<Symbol>>();
        foreach (var symbol in graph.SymbolList)
        {
            if (!byFile.TryGetValue(symbol.FilePath, out var list)) byFile[symbol.FilePath] = list = [];
            list.Add(symbol);
        }

        var files = new Dictionary<string, FileSymbolsView>();
        foreach (var (path, symbols) in byFile)
        {
            var module = symbols.FirstOrDefault(s => s.Kind == SymbolKind.Module);
            var view = new FileSymbolsView { Path = path, Module = module };
            view.Classes.AddRange(symbols.Where(s => s.Kind == SymbolKind.Class));
            view.Variables.AddRange(symbols.Where(s => s.Kind == SymbolKind.Variable));
            foreach (var cls in view.Classes) view.MethodsByClassId[cls.Id] = [];
            foreach (var symbol in symbols.Where(s => s.Kind == SymbolKind.Function))
            {
                if (symbol.ParentSymbolId is not null && view.MethodsByClassId.TryGetValue(symbol.ParentSymbolId, out var methods))
                    methods.Add(symbol);
                else if (module is not null && symbol.ParentSymbolId == module.Id)
                    view.Functions.Add(symbol);
            }
            files[path] = view;
        }
        return files;
    }

    private static IEnumerable<Symbol> CallableSymbols(FileSymbolsView file) =>
        file.Classes.Concat(file.MethodsByClassId.Values.SelectMany(m => m)).Concat(file.Functions);

    private static int FileSignal(DependencyIndex index, FileSymbolsView file) =>
        CallableSymbols(file).Sum(s => index.DependenciesOf(s.Id).Count + index.DependentsOf(s.Id).Count);

    private static string? NodeIdFor(Symbol symbol, Graph graph) => graph.Nodes.ContainsKey(symbol.Id) ? symbol.Id : null;

    private static bool IsTrivial(Symbol symbol, int callCount, DigestCaps caps) =>
        callCount == 0 && symbol.EndLine - symbol.StartLine + 1 <= caps.TrivialMaxBodyLines;

    private static int FileEntryCount(FileSymbolsView file, DependencyIndex index, Graph graph, DigestCaps caps)
    {
        var count = file.Classes.Count;
        foreach (var callable in file.MethodsByClassId.Values.SelectMany(m => m).Concat(file.Functions))
            if (!IsTrivial(callable, index.DependenciesOf(NodeIdFor(callable, graph) ?? "").Count, caps)) count++;
        return count;
    }

    private static JsonArray Strings(IEnumerable<string> values) => new(values.Select(v => (JsonNode)JsonValue.Create(v)!).ToArray());

    private static JsonObject SymbolEntry(DependencyIndex index, Graph graph, Symbol symbol, DigestCaps caps)
    {
        var nodeId = NodeIdFor(symbol, graph);
        var calls = nodeId is null ? [] : index.DependenciesOf(nodeId);
        var calledBy = nodeId is null ? [] : index.DependentsOf(nodeId);
        return new JsonObject
        {
            ["id"] = symbol.Id,
            ["node_id"] = nodeId,
            ["name"] = symbol.Name,
            ["is_trivial"] = IsTrivial(symbol, calls.Count, caps),
            ["calls"] = Strings(calls.Take(caps.MaxCalleesPerSymbol)),
            ["calls_overflow"] = Math.Max(0, calls.Count - caps.MaxCalleesPerSymbol),
            ["called_by"] = Strings(calledBy.Take(caps.MaxCallersPerSymbol)),
            ["called_by_overflow"] = Math.Max(0, calledBy.Count - caps.MaxCallersPerSymbol),
        };
    }

    private static JsonObject ClassDetail(DependencyIndex index, Graph graph, FileSymbolsView file, Symbol cls, DigestCaps caps)
    {
        var methods = new JsonArray();
        var omitted = 0;
        foreach (var method in file.MethodsByClassId[cls.Id].OrderBy(s => s.Name, StringComparer.Ordinal))
        {
            var entry = SymbolEntry(index, graph, method, caps);
            if ((bool)entry["is_trivial"]!) omitted++;
            else methods.Add(entry);
        }
        var classEntry = SymbolEntry(index, graph, cls, caps);
        classEntry["methods"] = methods;
        classEntry["methods_omitted"] = omitted;
        return classEntry;
    }

    private static JsonObject FileDetail(DependencyIndex index, Graph graph, FileSymbolsView file, DigestCaps caps)
    {
        var imports = file.Module is null
            ? []
            : file.Module.Imports.Values.Distinct().Order(StringComparer.Ordinal).ToList();

        var functions = new JsonArray();
        var functionsOmitted = 0;
        foreach (var function in file.Functions.OrderBy(s => s.Name, StringComparer.Ordinal))
        {
            var entry = SymbolEntry(index, graph, function, caps);
            if ((bool)entry["is_trivial"]!) functionsOmitted++;
            else functions.Add(entry);
        }

        var nodeId = $"component::{file.Path}";
        return new JsonObject
        {
            ["path"] = file.Path,
            ["node_id"] = graph.Nodes.ContainsKey(nodeId) ? nodeId : null,
            ["imports"] = Strings(imports.Take(caps.MaxImportsPerFile)),
            ["imports_overflow"] = Math.Max(0, imports.Count - caps.MaxImportsPerFile),
            ["classes"] = new JsonArray(file.Classes.OrderBy(c => c.Name, StringComparer.Ordinal)
                .Select(c => (JsonNode)ClassDetail(index, graph, file, c, caps)).ToArray()),
            ["classes_omitted"] = 0,
            ["functions"] = functions,
            ["functions_omitted"] = functionsOmitted,
        };
    }

    private static JsonObject BareFileEntry(FileSymbolsView file, Graph graph)
    {
        var nodeId = $"component::{file.Path}";
        return new JsonObject
        {
            ["path"] = file.Path,
            ["node_id"] = graph.Nodes.ContainsKey(nodeId) ? nodeId : null,
            ["detail_omitted"] = true,
        };
    }
}
