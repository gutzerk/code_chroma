namespace CodeChroma.Core.Patterns;

/// <summary>Free, synchronous heuristic pass over class shapes; mirrors patterns/detector.py (every candidate is unconfirmed).</summary>
public static class PatternDetector
{
    private static readonly string[] RepositorySuffixes = ["repository", "repo"];
    private static readonly string[] TestDoublePrefixes = ["Test", "Fake", "Mock", "Stub"];

    private sealed class Index
    {
        public required Graph Graph { get; init; }
        public required IReadOnlyDictionary<string, ClassShape> Shapes { get; init; }
        public required List<KeyValuePair<string, Symbol>> SortedSymbols { get; init; }
        public required List<KeyValuePair<string, ClassShape>> SortedShapes { get; init; }
        public required Dictionary<string, string> ClassIdByName { get; init; }
        public required Dictionary<string, HashSet<string>> ReferencesById { get; init; }
    }

    public static List<PatternInstance> DetectCandidates(Graph graph, IReadOnlyDictionary<string, ClassShape> shapes)
    {
        var index = BuildIndex(graph, shapes);
        return
        [
            .. DetectStrategy(index),
            .. DetectFacade(index),
            .. DetectAdapter(index),
            .. DetectRegistry(index),
            .. DetectSingleton(index),
            .. DetectSingletonGo(index),
            .. DetectObserver(index),
            .. DetectRepository(index),
        ];
    }

    private static Index BuildIndex(Graph graph, IReadOnlyDictionary<string, ClassShape> shapes)
    {
        var sortedSymbols = graph.Symbols.OrderBy(p => p.Key, StringComparer.Ordinal).ToList();
        var classIdByName = new Dictionary<string, string>();
        foreach (var (id, symbol) in sortedSymbols)
            if (symbol.Kind == SymbolKind.Class) classIdByName.TryAdd(symbol.Name, id);
        return new Index
        {
            Graph = graph,
            Shapes = shapes,
            SortedSymbols = sortedSymbols,
            SortedShapes = shapes.OrderBy(p => p.Key, StringComparer.Ordinal).ToList(),
            ClassIdByName = classIdByName,
            ReferencesById = sortedSymbols.ToDictionary(p => p.Key, p => p.Value.References.ToHashSet()),
        };
    }

    /// <summary>Symbol lookup that tolerates a shape whose symbol is gone (the Python index would raise; skip instead).</summary>
    private static Symbol? SymbolOf(Index index, string id) => index.Graph.Symbols.GetValueOrDefault(id);

    private static string NameOf(Index index, string id) => SymbolOf(index, id)?.Name ?? id;

    private static Dictionary<string, List<string>> StructuralInterfaceMatches(Index index)
    {
        var matches = new Dictionary<string, List<string>>();
        foreach (var (interfaceId, interfaceShape) in index.SortedShapes.Where(p => p.Value.Kind == "interface"))
        {
            var methodNames = interfaceShape.Methods.Keys.ToHashSet();
            if (methodNames.Count == 0) continue;
            var interfaceName = NameOf(index, interfaceId);
            foreach (var (id, shape) in index.SortedShapes)
            {
                if (id == interfaceId || shape.Kind == "interface") continue;
                if (methodNames.IsSubsetOf(shape.Methods.Keys))
                {
                    if (!matches.TryGetValue(interfaceName, out var list)) matches[interfaceName] = list = [];
                    list.Add(id);
                }
            }
        }
        return matches;
    }

    private static Dictionary<string, List<string>> ImplementationsByBase(Index index)
    {
        var byBase = new Dictionary<string, List<string>>();
        foreach (var (id, shape) in index.Shapes)
            foreach (var @base in shape.Bases)
            {
                if (!byBase.TryGetValue(@base, out var list)) byBase[@base] = list = [];
                list.Add(id);
            }
        foreach (var (baseName, implIds) in StructuralInterfaceMatches(index))
        {
            if (!byBase.TryGetValue(baseName, out var existing)) byBase[baseName] = existing = [];
            foreach (var implId in implIds)
                if (!existing.Contains(implId)) existing.Add(implId);
        }
        return byBase;
    }

    private static PatternParticipant Participant(Index index, string id, PatternRole role)
    {
        var symbol = SymbolOf(index, id);
        if (symbol is null) return new PatternParticipant(id, role, id, id);
        return new PatternParticipant(id, role, symbol.Name, symbol.QualifiedName,
            index.Graph.Nodes.ContainsKey(id) ? id : null, symbol.FilePath);
    }

    private static PatternParticipant FreeParticipant(string ownerId, string attrName, PatternRole role) =>
        new($"attr::{ownerId}::{attrName}", role, attrName, attrName);

    private static string? FindDispatcher(Index index, HashSet<string> excluded, HashSet<string> methodNames)
    {
        foreach (var (id, symbol) in index.SortedSymbols)
        {
            if (excluded.Contains(id) || symbol.Kind != SymbolKind.Class) continue;
            if (methodNames.Overlaps(index.ReferencesById[id])) return id;
        }
        return null;
    }

    private static (List<PatternParticipant> Participants, List<PatternRelation> Relations) InterfaceImplGroup(
        Index index, string interfaceId, IEnumerable<string> implIds)
    {
        var sorted = implIds.OrderBy(i => i, StringComparer.Ordinal).ToList();
        var participants = new List<PatternParticipant> { Participant(index, interfaceId, PatternRole.Interface) };
        participants.AddRange(sorted.Select(i => Participant(index, i, PatternRole.Implementation)));
        var relations = sorted.Select(i => new PatternRelation(i, interfaceId, PatternRelationKind.Implements)).ToList();
        return (participants, relations);
    }

    private static IEnumerable<PatternInstance> DetectStrategy(Index index)
    {
        foreach (var (baseName, implIds) in ImplementationsByBase(index).OrderBy(p => p.Key, StringComparer.Ordinal))
        {
            if (implIds.Count < 2) continue;
            if (!index.ClassIdByName.TryGetValue(baseName, out var baseId)) continue;
            if (!index.Shapes.TryGetValue(baseId, out var baseShape) || !baseShape.IsAbstract) continue;
            var methodNames = baseShape.Methods.Keys.ToHashSet();
            if (methodNames.Count == 0) continue;
            var (participants, relations) = InterfaceImplGroup(index, baseId, implIds);
            var excluded = new HashSet<string>(implIds) { baseId };
            var dispatcherId = FindDispatcher(index, excluded, methodNames);
            if (dispatcherId is not null)
            {
                participants.Add(Participant(index, dispatcherId, PatternRole.Dispatcher));
                relations.Add(new PatternRelation(dispatcherId, baseId, PatternRelationKind.Uses));
            }
            yield return new PatternInstance($"strategy::{baseId}", PatternType.Strategy,
                $"Strategy — {NameOf(index, baseId)} dispatch", 0.6, participants, relations);
        }
    }

    private static HashSet<string> AggregatedCallsOnAttr(ClassShape shape) =>
        shape.Methods.Values.SelectMany(m => m.CallsOnAttr.Keys).ToHashSet();

    private static IEnumerable<PatternInstance> DetectFacade(Index index)
    {
        foreach (var (id, shape) in index.SortedShapes)
        {
            var attrs = AggregatedCallsOnAttr(shape);
            if (shape.Methods.Count == 0 || shape.Methods.Count > 6 || attrs.Count < 3) continue;
            var participants = new List<PatternParticipant> { Participant(index, id, PatternRole.Facade) };
            var relations = new List<PatternRelation>();
            foreach (var attr in attrs.OrderBy(a => a, StringComparer.Ordinal))
            {
                var target = FreeParticipant(id, attr, PatternRole.Target);
                participants.Add(target);
                relations.Add(new PatternRelation(id, target.Id, PatternRelationKind.Wraps));
            }
            yield return new PatternInstance($"facade::{id}", PatternType.Facade, $"Facade — {NameOf(index, id)}",
                0.35, participants, relations);
        }
    }

    private static IEnumerable<PatternInstance> DetectAdapter(Index index)
    {
        foreach (var (id, shape) in index.SortedShapes)
        {
            if (!NameOf(index, id).Contains("adapter", StringComparison.OrdinalIgnoreCase)) continue;
            var attrs = AggregatedCallsOnAttr(shape);
            if (attrs.Count != 1) continue;
            var participants = new List<PatternParticipant> { Participant(index, id, PatternRole.Adapter) };
            var relations = new List<PatternRelation>();
            foreach (var @base in shape.Bases)
            {
                if (!index.ClassIdByName.TryGetValue(@base, out var baseId)) continue;
                participants.Add(Participant(index, baseId, PatternRole.Target));
                relations.Add(new PatternRelation(id, baseId, PatternRelationKind.Implements));
            }
            var adaptee = FreeParticipant(id, attrs.First(), PatternRole.Adaptee);
            participants.Add(adaptee);
            relations.Add(new PatternRelation(id, adaptee.Id, PatternRelationKind.Wraps));
            yield return new PatternInstance($"adapter::{id}", PatternType.Adapter, $"Adapter — {NameOf(index, id)}",
                0.55, participants, relations);
        }
    }

    private static IEnumerable<PatternInstance> DetectRegistry(Index index)
    {
        foreach (var (id, shape) in index.SortedShapes)
        {
            var registryAttrs = shape.ClassAttrs.Where(p => p.Value is "dict" or "map").Select(p => p.Key).ToHashSet();
            var writers = shape.Methods.Values.SelectMany(m => m.WritesDictAttrs).ToHashSet();
            if (!registryAttrs.Overlaps(writers)) continue;
            var participants = new List<PatternParticipant> { Participant(index, id, PatternRole.Registry) };
            var relations = new List<PatternRelation>();
            var methodNames = shape.Methods.Keys.ToHashSet();
            foreach (var (otherId, other) in index.SortedSymbols)
            {
                if (otherId == id || other.Kind != SymbolKind.Class) continue;
                if (!methodNames.Overlaps(index.ReferencesById[otherId])) continue;
                participants.Add(Participant(index, otherId, PatternRole.Entry));
                relations.Add(new PatternRelation(otherId, id, PatternRelationKind.Registers));
            }
            yield return new PatternInstance($"registry::{id}", PatternType.Registry, $"Registry — {NameOf(index, id)}",
                0.6, participants, relations);
        }
    }

    private static IEnumerable<PatternInstance> DetectSingleton(Index index)
    {
        foreach (var (id, shape) in index.SortedShapes)
        {
            var checkedAttrs = shape.Methods.Values.SelectMany(m => m.ChecksNoneClassAttr).ToHashSet();
            var setAttrs = shape.Methods.Values.SelectMany(m => m.SetsClassAttr).ToHashSet();
            if (!checkedAttrs.Overlaps(setAttrs)) continue;
            yield return new PatternInstance($"singleton::{id}", PatternType.Singleton, $"Singleton — {NameOf(index, id)}",
                0.7, [Participant(index, id, PatternRole.Instance)], []);
        }
    }

    private static IEnumerable<PatternInstance> DetectSingletonGo(Index index)
    {
        foreach (var (id, symbol) in index.SortedSymbols)
        {
            if (symbol.Kind != SymbolKind.Variable) continue;
            var module = symbol.ParentSymbolId is null ? null : SymbolOf(index, symbol.ParentSymbolId);
            if (module is null || !module.Imports.Values.Contains("sync")) continue;
            var usesOnce = index.Graph.Symbols.Values.Any(other =>
                other.Kind == SymbolKind.Function && other.ParentSymbolId == symbol.ParentSymbolId
                && other.References.Contains("Do") && other.AssignedIdentifiers.Contains(symbol.Name));
            if (!usesOnce) continue;
            var pointee = symbol.References.Count > 0 ? symbol.References[0] : symbol.Name;
            var targetId = index.ClassIdByName.GetValueOrDefault(pointee, id);
            yield return new PatternInstance($"singleton::{id}", PatternType.Singleton, $"Singleton — {pointee}", 0.6,
                [Participant(index, targetId, PatternRole.Instance)], []);
        }
    }

    private static IEnumerable<PatternInstance> DetectObserver(Index index)
    {
        foreach (var (id, shape) in index.SortedShapes)
        {
            var appended = shape.Methods.Values.SelectMany(m => m.AppendsListAttrs).ToHashSet();
            var iterated = shape.Methods.Values.SelectMany(m => m.IteratesAttrs).ToHashSet();
            if (!appended.Overlaps(iterated)) continue;
            yield return new PatternInstance($"observer::{id}", PatternType.Observer, $"Observer — {NameOf(index, id)}",
                0.45, [Participant(index, id, PatternRole.Subject)], []);
        }
    }

    private static bool IsRepositoryLike(string name)
    {
        var lower = name.ToLowerInvariant();
        return RepositorySuffixes.Append("interface").Any(s => lower.EndsWith(s, StringComparison.Ordinal));
    }

    private static bool IsInterfaceNamed(string name) => name.Length > 1 && name[0] == 'I' && char.IsUpper(name[1]);

    private static string StripNamingPrefix(string name)
    {
        if (IsInterfaceNamed(name)) return name[1..];
        foreach (var prefix in TestDoublePrefixes)
            if (name.StartsWith(prefix, StringComparison.Ordinal) && name.Length > prefix.Length && char.IsUpper(name[prefix.Length]))
                return name[prefix.Length..];
        return name;
    }

    private static IEnumerable<PatternInstance> DetectRepository(Index index)
    {
        var byName = index.ClassIdByName;
        var grouped = new Dictionary<string, List<string>>();
        var standalone = new List<string>();
        foreach (var (id, shape) in index.SortedShapes)
        {
            var nameLower = NameOf(index, id).ToLowerInvariant();
            if (!RepositorySuffixes.Any(s => nameLower.EndsWith(s, StringComparison.Ordinal))) continue;
            var interfaceBase = shape.Bases.FirstOrDefault(b => byName.ContainsKey(b) && IsRepositoryLike(b));
            if (interfaceBase is not null)
            {
                var interfaceId = byName[interfaceBase];
                if (!grouped.TryGetValue(interfaceId, out var list)) grouped[interfaceId] = list = [];
                list.Add(id);
            }
            else standalone.Add(id);
        }

        foreach (var (interfaceId, implIds) in grouped.OrderBy(p => p.Key, StringComparer.Ordinal))
        {
            var (participants, relations) = InterfaceImplGroup(index, interfaceId, implIds);
            yield return new PatternInstance($"repository::{interfaceId}", PatternType.Repository,
                $"Repository — {NameOf(index, interfaceId)}", 0.55, participants, relations);
        }

        var families = new Dictionary<string, List<string>>();
        foreach (var id in standalone.Where(id => !grouped.ContainsKey(id)))
        {
            var family = StripNamingPrefix(NameOf(index, id));
            if (!families.TryGetValue(family, out var list)) families[family] = list = [];
            list.Add(id);
        }

        foreach (var (family, memberIds) in families.OrderBy(p => p.Key, StringComparer.Ordinal))
        {
            var members = memberIds.OrderBy(i => i, StringComparer.Ordinal).ToList();
            if (members.Count == 1)
            {
                yield return new PatternInstance($"repository::{members[0]}", PatternType.Repository,
                    $"Repository — {NameOf(index, members[0])}", 0.5,
                    [Participant(index, members[0], PatternRole.Implementation)], []);
                continue;
            }
            var interfaceId = members.FirstOrDefault(m => IsInterfaceNamed(NameOf(index, m)));
            var participants = new List<PatternParticipant>();
            if (interfaceId is not null) participants.Add(Participant(index, interfaceId, PatternRole.Interface));
            var relations = new List<PatternRelation>();
            foreach (var member in members)
            {
                if (member == interfaceId) continue;
                participants.Add(Participant(index, member, PatternRole.Implementation));
                if (interfaceId is not null) relations.Add(new PatternRelation(member, interfaceId, PatternRelationKind.Implements));
            }
            yield return new PatternInstance($"repository::{interfaceId ?? members[0]}", PatternType.Repository,
                $"Repository — {family}", 0.5, participants, relations);
        }
    }
}
