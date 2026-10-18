namespace CodeChroma.Core;

/// <summary>Assembles the 7-level hierarchy as a 1:1 mirror of the directory tree, then decomposes each file.</summary>
public static class GraphBuilder
{
    private static readonly Dictionary<string, string> ControlFlowLabels = new()
    {
        ["if_statement"] = "Conditional Branch",
        ["for_statement"] = "Loop",
        ["for_in_statement"] = "Loop",
        ["while_statement"] = "Loop",
        ["do_statement"] = "Loop",
        ["try_statement"] = "Error Handling",
        ["with_statement"] = "Context Block",
        ["switch_statement"] = "Conditional Branch",
    };

    /// <summary>Doc file extensions; also what a folder needs to be entirely made of to be doc_only.</summary>
    public static readonly IReadOnlySet<string> DocExtensions = new HashSet<string> { ".md", ".rst", ".txt", ".adoc" };

    public static BuildResult Build(IReadOnlyList<FileSymbols> files, IImportResolver? resolver = null)
    {
        var parsed = files.Where(f => f.Symbols is not null).ToList();
        var placeholders = files.Where(f => f.Symbols is null).Select(f => f.Path).ToList();

        var allSymbols = new OrderedMap<string, Symbol>();
        var moduleByFile = new Dictionary<string, Symbol>();
        foreach (var file in parsed)
            foreach (var symbol in file.Symbols!)
            {
                allSymbols[symbol.Id] = symbol;
                if (symbol.Kind == SymbolKind.Module) moduleByFile[file.Path] = symbol;
            }

        var topLevel = new Dictionary<string, List<Symbol>>();
        foreach (var file in parsed)
        {
            moduleByFile.TryGetValue(file.Path, out var module);
            topLevel[file.Path] = file.Symbols!
                .Where(s => s.Kind is SymbolKind.Class or SymbolKind.Function && module is not null && s.ParentSymbolId == module.Id)
                .ToList();
        }

        var edges = ResolveSymbolEdges(allSymbols, moduleByFile, topLevel, resolver);

        var nodes = new OrderedMap<string, HierarchyNode>();
        foreach (var file in parsed)
        {
            var componentId = AddComponent(nodes, file.Path);
            BuildFileHierarchy(nodes, file.Path, file.Symbols!, topLevel[file.Path], componentId);
        }
        foreach (var path in placeholders) AddComponent(nodes, path);

        ComputeDocOnly(nodes);
        ApplyDependencyEdges(nodes, edges);

        return new BuildResult(nodes.Values.ToList(), allSymbols.Values.ToList());
    }

    public static string? SymbolOrigin(Symbol? symbol) => symbol is null ? null : $"{symbol.FilePath}:{symbol.StartLine}";

    private static string ParentDir(string filePath)
    {
        var slash = filePath.LastIndexOf('/');
        return slash < 0 ? "." : filePath[..slash];
    }

    private static string BaseName(string filePath) => filePath[(filePath.LastIndexOf('/') + 1)..];

    /// <summary>Python's Path.suffix: empty for a dotfile or a trailing dot.</summary>
    private static string Suffix(string path)
    {
        var name = BaseName(path);
        var dot = name.LastIndexOf('.');
        return dot <= 0 || dot == name.Length - 1 ? "" : name[dot..];
    }

    private static string? EnsureDirChain(OrderedMap<string, HierarchyNode> nodes, string filePath)
    {
        var parts = filePath.Split('/')[..^1];
        string? parentId = null;
        var pathSoFar = "";
        for (var depth = 0; depth < parts.Length; depth++)
        {
            pathSoFar = depth == 0 ? parts[depth] : $"{pathSoFar}/{parts[depth]}";
            var dirId = $"dir::{pathSoFar}";
            if (!nodes.ContainsKey(dirId))
                nodes[dirId] = new HierarchyNode
                {
                    Id = dirId, Name = parts[depth], SourcePath = pathSoFar,
                    Level = depth == 0 ? HierarchyLevel.System : HierarchyLevel.Pillar,
                    ParentIds = parentId is null ? [] : [parentId],
                };
            parentId = dirId;
        }
        return parentId;
    }

    private static string AddComponent(OrderedMap<string, HierarchyNode> nodes, string filePath)
    {
        var parentDirId = EnsureDirChain(nodes, filePath);
        var componentId = $"component::{filePath}";
        nodes[componentId] = new HierarchyNode
        {
            Id = componentId, Name = BaseName(filePath), Level = HierarchyLevel.Component,
            ParentIds = parentDirId is null ? [] : [parentDirId], SourcePath = filePath,
        };
        return componentId;
    }

    private static void ComputeDocOnly(OrderedMap<string, HierarchyNode> nodes)
    {
        var childrenByParent = new Dictionary<string, List<string>>();
        foreach (var node in nodes.Values)
            foreach (var parentId in node.ParentIds)
            {
                if (!childrenByParent.TryGetValue(parentId, out var list)) childrenByParent[parentId] = list = [];
                list.Add(node.Id);
            }

        var dirNodes = nodes.Values
            .Where(n => n.Level is HierarchyLevel.System or HierarchyLevel.Pillar)
            .OrderByDescending(n => (n.SourcePath ?? "").Count(c => c == '/'))
            .ToList();

        var docOnly = new Dictionary<string, bool>();
        foreach (var dir in dirNodes)
        {
            var isDocOnly = true;
            foreach (var childId in childrenByParent.GetValueOrDefault(dir.Id) ?? [])
            {
                var child = nodes[childId];
                bool childIsDoc;
                if (child.Level == HierarchyLevel.Component)
                    childIsDoc = DocExtensions.Contains(Suffix(child.SourcePath ?? "").ToLowerInvariant());
                else if (child.Level is HierarchyLevel.System or HierarchyLevel.Pillar)
                    childIsDoc = docOnly.GetValueOrDefault(child.Id);
                else
                    continue;
                if (!childIsDoc)
                {
                    isDocOnly = false;
                    break;
                }
            }
            docOnly[dir.Id] = isDocOnly;
        }
        foreach (var (id, value) in docOnly) nodes[id] = nodes[id] with { DocOnly = value };
    }

    private static OrderedMap<string, SortedSet<string>> ResolveSymbolEdges(
        OrderedMap<string, Symbol> allSymbols,
        Dictionary<string, Symbol> moduleByFile,
        Dictionary<string, List<Symbol>> topLevel,
        IImportResolver? resolver)
    {
        var nameIndex = new Dictionary<string, Dictionary<string, Symbol>>();
        foreach (var (file, symbols) in topLevel)
        {
            var byName = new Dictionary<string, Symbol>();
            foreach (var s in symbols) byName[s.Name] = s;
            nameIndex[file] = byName;
        }
        // A Go import names a directory, so the files of one directory pool their top-level names.
        var dirNameIndex = new Dictionary<string, Dictionary<string, Symbol>>();
        foreach (var file in topLevel.Keys)
        {
            var dir = ParentDir(file);
            if (!dirNameIndex.TryGetValue(dir, out var merged)) dirNameIndex[dir] = merged = [];
            foreach (var (name, symbol) in nameIndex[file]) merged[name] = symbol;
        }

        Dictionary<string, Symbol>? TargetIndex(string importer, string dotted)
        {
            var candidate = resolver?.Resolve(importer, dotted);
            if (candidate is null) return null;
            if (nameIndex.TryGetValue(candidate, out var byFile)) return byFile;
            return dirNameIndex.GetValueOrDefault(candidate);
        }

        var edges = new OrderedMap<string, SortedSet<string>>();
        foreach (var symbol in allSymbols.Values)
        {
            if (symbol.Kind is not (SymbolKind.Class or SymbolKind.Function)) continue;
            var targets = new SortedSet<string>(StringComparer.Ordinal);
            moduleByFile.TryGetValue(symbol.FilePath, out var module);
            foreach (var refName in symbol.References)
            {
                Symbol? target = null;
                if (nameIndex.TryGetValue(symbol.FilePath, out var local)) local.TryGetValue(refName, out target);
                if (target is null && module is not null && module.Imports.TryGetValue(refName, out var dotted))
                    TargetIndex(symbol.FilePath, dotted)?.TryGetValue(refName, out target);
                if (target is not null && target.Id != symbol.Id) targets.Add(target.Id);
            }
            foreach (var (qualifier, name) in symbol.QualifiedReferences)
            {
                if (module is null || !module.Imports.TryGetValue(qualifier, out var dotted)) continue;
                var index = TargetIndex(symbol.FilePath, dotted);
                if (index is null) continue;
                if (index.TryGetValue(name, out var target) && target.Id != symbol.Id) targets.Add(target.Id);
            }
            if (targets.Count > 0) edges[symbol.Id] = targets;
        }
        return edges;
    }

    private static void BuildFileHierarchy(
        OrderedMap<string, HierarchyNode> nodes, string filePath, IReadOnlyList<Symbol> symbols,
        List<Symbol> topLevel, string componentId)
    {
        foreach (var cls in topLevel.Where(s => s.Kind == SymbolKind.Class))
        {
            nodes[cls.Id] = new HierarchyNode
            {
                Id = cls.Id, Name = cls.Name, Level = HierarchyLevel.Service,
                ParentIds = [componentId], SourcePath = filePath,
            };
            foreach (var method in symbols.Where(s => s.Kind == SymbolKind.Function && s.ParentSymbolId == cls.Id))
                BuildFunctionNode(nodes, method, cls.Id, filePath);
        }

        var bareFunctions = topLevel.Where(s => s.Kind == SymbolKind.Function).ToList();
        if (bareFunctions.Count == 0) return;
        var serviceId = $"service::{filePath}::functions";
        nodes[serviceId] = new HierarchyNode
        {
            Id = serviceId, Name = "Module Functions", Level = HierarchyLevel.Service,
            ParentIds = [componentId], SourcePath = filePath,
        };
        foreach (var function in bareFunctions) BuildFunctionNode(nodes, function, serviceId, filePath);
    }

    private static void BuildFunctionNode(
        OrderedMap<string, HierarchyNode> nodes, Symbol function, string parentServiceId, string filePath)
    {
        nodes[function.Id] = new HierarchyNode
        {
            Id = function.Id, Name = function.Name, Level = HierarchyLevel.Function,
            ParentIds = [parentServiceId], SourcePath = filePath,
        };

        var index = 0;
        foreach (var (label, start, end) in ExtractLogicBlocks(function))
        {
            var blockId = $"logicblock::{function.Id}::{index++}";
            var span = $"{filePath}:{start}-{end}";
            nodes[blockId] = new HierarchyNode
            {
                Id = blockId, Name = label, Level = HierarchyLevel.LogicBlock,
                ParentIds = [function.Id], SourcePath = span,
            };
            var codeId = $"code::{blockId}";
            nodes[codeId] = new HierarchyNode
            {
                Id = codeId, Name = span, Level = HierarchyLevel.Code, ParentIds = [blockId], SourcePath = span,
            };
        }
    }

    private static List<(string Label, int Start, int End)> ExtractLogicBlocks(Symbol function)
    {
        var statements = function.BodyStatements;
        if (statements.Count == 0) return [("Body", function.StartLine, function.EndLine)];

        var raw = new List<(string? Label, int Start, int End)>();
        var current = new List<(int Start, int End)>();
        foreach (var statement in statements)
        {
            if (ControlFlowLabels.TryGetValue(statement.Type, out var label))
            {
                if (current.Count > 0)
                {
                    raw.Add((null, current[0].Start, current[^1].End));
                    current.Clear();
                }
                raw.Add((label, statement.StartLine, statement.EndLine));
            }
            else
            {
                current.Add((statement.StartLine, statement.EndLine));
            }
        }
        if (current.Count > 0) raw.Add((null, current[0].Start, current[^1].End));

        var step = 0;
        return raw.Select(b => (b.Label ?? $"Step {++step}", b.Start, b.End)).ToList();
    }

    private static void ApplyDependencyEdges(OrderedMap<string, HierarchyNode> nodes, OrderedMap<string, SortedSet<string>> edges)
    {
        foreach (var (symbolId, targets) in edges)
        {
            if (!nodes.ContainsKey(symbolId)) continue;
            var present = targets.Where(nodes.ContainsKey).ToList();
            if (present.Count > 0) nodes[symbolId] = nodes[symbolId] with { DependsOnIds = present };
        }
    }
}
