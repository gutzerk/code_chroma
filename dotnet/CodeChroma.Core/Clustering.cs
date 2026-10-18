namespace CodeChroma.Core;

/// <summary>
/// Deterministic file, component and container clustering from real call/import edges. Each level asks an
/// ordered chain of signals (folder default, call-graph majority, merge by aggregate traffic, import fallback
/// for files) and escalates only when none answer.
/// </summary>
public static class Clustering
{
    public const string RootFolder = "<root>";

    /// <summary>CI/tooling clutter (workflows, root configs, fixtures): the gitignore patterns .github/, .specify/, testdata/, /*.yaml, /*.yml.</summary>
    public static bool IsInfraPath(string path)
    {
        var segments = path.Split('/');
        if (segments[..^1].Any(s => s is ".github" or ".specify" or "testdata")) return true;
        return segments[0].EndsWith(".yaml", StringComparison.Ordinal) || segments[0].EndsWith(".yml", StringComparison.Ordinal);
    }

    public static string? PluralityWinner(IReadOnlyDictionary<string, int> votes)
    {
        var counter = new Counter();
        foreach (var (key, count) in votes) counter.Add(key, count);
        return counter.Winner();
    }

    private static (string, string) PairKey(string a, string b) => string.CompareOrdinal(a, b) < 0 ? (a, b) : (b, a);

    private static OrderedMap<string, Counter> NeighborWeights(IEnumerable<KeyValuePair<(string, string), int>> edgeWeights)
    {
        var neighbors = new OrderedMap<string, Counter>();
        foreach (var ((a, b), weight) in edgeWeights)
        {
            if (!neighbors.TryGetValue(a, out var ca)) neighbors[a] = ca = new Counter();
            if (!neighbors.TryGetValue(b, out var cb)) neighbors[b] = cb = new Counter();
            ca.Add(b, weight);
            cb.Add(a, weight);
        }
        return neighbors;
    }

    private static Counter NeighborVotes(string item, Dictionary<string, string> groupOf, OrderedMap<string, Counter> neighbors)
    {
        var votes = new Counter();
        if (!neighbors.TryGetValue(item, out var mine)) return votes;
        foreach (var (other, weight) in mine.Items)
            if (groupOf.TryGetValue(other, out var group)) votes.Add(group, weight);
        return votes;
    }

    private static HashSet<string> ConnectedComponent(string start, OrderedMap<string, Counter> neighbors, HashSet<string> allowed)
    {
        var seen = new HashSet<string> { start };
        var stack = new Stack<string>([start]);
        while (stack.Count > 0)
        {
            var current = stack.Pop();
            if (!neighbors.TryGetValue(current, out var mine)) continue;
            foreach (var (neighbor, weight) in mine.Items)
                if (weight > 0 && allowed.Contains(neighbor) && seen.Add(neighbor)) stack.Push(neighbor);
        }
        return seen;
    }

    /// <summary>folder/parent default, then call-graph majority, then aggregate merge; returns the groups and what stayed unresolved.</summary>
    private static (Dictionary<string, string> GroupOf, List<string> Unresolved) ResolveChain(
        List<string> items, Func<string, string?> defaultGroupOf, IEnumerable<KeyValuePair<(string, string), int>> edgeWeights)
    {
        var groupOf = new Dictionary<string, string>();
        foreach (var item in items)
            if (defaultGroupOf(item) is { } group) groupOf[item] = group;

        var neighbors = NeighborWeights(edgeWeights);
        foreach (var item in items.Where(i => !groupOf.ContainsKey(i)).ToList())
            if (NeighborVotes(item, groupOf, neighbors).Winner() is { } winner) groupOf[item] = winner;

        var remaining = items.Where(i => !groupOf.ContainsKey(i)).ToList();
        var remainingSet = remaining.ToHashSet();
        var visited = new HashSet<string>();
        foreach (var item in remaining)
        {
            if (visited.Contains(item)) continue;
            var component = ConnectedComponent(item, neighbors, remainingSet);
            visited.UnionWith(component);
            if (component.Count < 2) continue;
            var mergedId = $"merged::{component.Order(StringComparer.Ordinal).First()}";
            foreach (var member in component) groupOf[member] = mergedId;
        }

        return (groupOf, items.Where(i => !groupOf.ContainsKey(i)).ToList());
    }

    /// <summary>Rolls item-level edges up to their groups' edges; drops intra-group and unmapped traffic.</summary>
    public static Dictionary<(string, string), int> AggregateEdgeList(
        IReadOnlyDictionary<string, string> groupOf, IEnumerable<(string From, string To, int Count)> edges)
    {
        var aggregated = new Dictionary<(string, string), int>();
        foreach (var (a, b, weight) in edges)
        {
            if (!groupOf.TryGetValue(a, out var groupA) || !groupOf.TryGetValue(b, out var groupB) || groupA == groupB) continue;
            var key = PairKey(groupA, groupB);
            aggregated[key] = (aggregated.TryGetValue(key, out var n) ? n : 0) + weight;
        }
        return aggregated;
    }

    private static OrderedMap<(string, string), int> AggregateEdges(
        Dictionary<string, string> groupOf, IEnumerable<KeyValuePair<(string, string), int>> edges)
    {
        var aggregated = new OrderedMap<(string, string), int>();
        foreach (var ((a, b), weight) in edges)
        {
            if (!groupOf.TryGetValue(a, out var groupA) || !groupOf.TryGetValue(b, out var groupB) || groupA == groupB) continue;
            var key = PairKey(groupA, groupB);
            aggregated[key] = (aggregated.TryGetValue(key, out var n) ? n : 0) + weight;
        }
        return aggregated;
    }

    private static string FileFolder(string path)
    {
        var slash = path.LastIndexOf('/');
        return slash < 0 ? RootFolder : path[..slash];
    }

    /// <summary>Aggregate, bidirectional, cross-file call-graph traffic per unordered file pair.</summary>
    public static IReadOnlyDictionary<(string, string), int> FileEdgeWeights(Graph graph)
    {
        var weights = new OrderedMap<(string, string), int>();
        foreach (var (fromId, toId) in new DependencyIndex(graph).Edges())
        {
            if (!graph.Symbols.TryGetValue(fromId, out var from) || !graph.Symbols.TryGetValue(toId, out var to)) continue;
            if (from.FilePath == to.FilePath) continue;
            var key = PairKey(from.FilePath, to.FilePath);
            weights[key] = (weights.TryGetValue(key, out var n) ? n : 0) + 1;
        }
        return weights;
    }

    private static OrderedMap<(string, string), int> RawImportEdges(Graph graph, IImportResolver resolver, Dictionary<string, List<string>> filesByDir)
    {
        var weights = new OrderedMap<(string, string), int>();
        foreach (var symbol in graph.SymbolList)
        {
            if (symbol.Kind != SymbolKind.Module || symbol.Imports.Count == 0) continue;
            foreach (var dotted in symbol.Imports.Values.Distinct())
            {
                var candidate = resolver.Resolve(symbol.FilePath, dotted);
                if (candidate is null) continue;
                foreach (var target in filesByDir.TryGetValue(candidate, out var inDir) ? inDir : [candidate])
                {
                    if (target == symbol.FilePath) continue;
                    var key = PairKey(symbol.FilePath, target);
                    weights[key] = (weights.TryGetValue(key, out var n) ? n : 0) + 1;
                }
            }
        }
        return weights;
    }

    private static (Dictionary<string, string> GroupOf, List<string> Unresolved) BuildComponentClusters(
        Graph graph, IImportResolver resolver, IEnumerable<KeyValuePair<(string, string), int>> edgeWeights)
    {
        var files = graph.SymbolList.Select(s => s.FilePath).Distinct().Where(f => !IsInfraPath(f)).Order(StringComparer.Ordinal).ToList();
        var folderCounts = new Counter();
        foreach (var file in files) folderCounts.Add(FileFolder(file));
        var trivialRepo = files.Count <= 1;
        string? FolderDefault(string file)
        {
            var folder = FileFolder(file);
            return trivialRepo || folderCounts[folder] >= 2 ? $"folder::{folder}" : null;
        }

        var (groupOf, unresolved) = ResolveChain(files, FolderDefault, edgeWeights);

        var filesByDir = new Dictionary<string, List<string>>();
        foreach (var file in files)
        {
            var slash = file.LastIndexOf('/');
            var dir = slash < 0 ? "." : file[..slash];
            if (!filesByDir.TryGetValue(dir, out var list)) filesByDir[dir] = list = [];
            list.Add(file);
        }
        var importNeighbors = NeighborWeights(RawImportEdges(graph, resolver, filesByDir));
        foreach (var file in unresolved.ToList())
        {
            if (NeighborVotes(file, groupOf, importNeighbors).Winner() is not { } winner) continue;
            groupOf[file] = winner;
            unresolved.Remove(file);
        }
        return (groupOf, unresolved);
    }

    private static string TopSegment(string path) => path.Split('/')[0];

    private static Dictionary<string, string> BuildContainerClusters(
        List<ComponentCluster> components, IEnumerable<KeyValuePair<(string, string), int>> componentEdges)
    {
        var topByComponent = new Dictionary<string, string?>();
        foreach (var component in components)
        {
            var counter = new Counter();
            foreach (var file in component.Files) counter.Add(TopSegment(file));
            topByComponent[component.Id] = counter.Winner();
        }
        var segmentCounts = new Counter();
        foreach (var segment in topByComponent.Values.OfType<string>()) segmentCounts.Add(segment);
        var trivial = components.Count <= 1;
        string? ContainerDefault(string componentId)
        {
            var segment = topByComponent.GetValueOrDefault(componentId);
            if (segment is null) return null;
            return trivial || segmentCounts[segment] >= 2 ? $"top::{segment}" : null;
        }

        var (groupOf, unresolved) = ResolveChain(components.Select(c => c.Id).ToList(), ContainerDefault, componentEdges);
        foreach (var componentId in unresolved) groupOf[componentId] = $"solo::{componentId}";
        return groupOf;
    }

    public static ClusterResult Build(Graph graph, IImportResolver resolver)
    {
        var weights = (OrderedMap<(string, string), int>)FileEdgeWeights(graph);
        var (fileGroupOf, undetermined) = BuildComponentClusters(graph, resolver, weights);

        var filesByGroup = new Dictionary<string, List<string>>();
        foreach (var (file, group) in fileGroupOf)
        {
            if (!filesByGroup.TryGetValue(group, out var list)) filesByGroup[group] = list = [];
            list.Add(file);
        }
        var components = filesByGroup.OrderBy(kv => kv.Key, StringComparer.Ordinal)
            .Select(kv => new ComponentCluster(kv.Key, "", kv.Value.Order(StringComparer.Ordinal).ToList())).ToList();
        var componentEdgeWeights = AggregateEdges(fileGroupOf, weights);

        var containerGroupOf = BuildContainerClusters(components, componentEdgeWeights);
        components = components.Select(c => c with { ContainerId = containerGroupOf[c.Id] }).ToList();

        var idsByContainer = new Dictionary<string, List<string>>();
        foreach (var component in components)
        {
            if (!idsByContainer.TryGetValue(component.ContainerId, out var list)) idsByContainer[component.ContainerId] = list = [];
            list.Add(component.Id);
        }
        var containers = idsByContainer.OrderBy(kv => kv.Key, StringComparer.Ordinal)
            .Select(kv => new ContainerCluster(kv.Key, kv.Value.Order(StringComparer.Ordinal).ToList())).ToList();
        var containerEdgeWeights = AggregateEdges(containerGroupOf, componentEdgeWeights);

        return new ClusterResult(
            components, containers, SortedEdges(componentEdgeWeights), SortedEdges(containerEdgeWeights),
            undetermined.Order(StringComparer.Ordinal).ToList(), weights);
    }

    private static List<ClusterEdge> SortedEdges(OrderedMap<(string, string), int> weights) =>
        weights.Where(kv => kv.Value >= 1)
            .OrderBy(kv => kv.Key.Item1, StringComparer.Ordinal).ThenBy(kv => kv.Key.Item2, StringComparer.Ordinal)
            .Select(kv => new ClusterEdge(kv.Key.Item1, kv.Key.Item2, kv.Value)).ToList();

    /// <summary>Two or three real candidate components (id and already-assigned files) closest to the file, never code.</summary>
    public static IReadOnlyList<UndeterminedCandidate> UndeterminedCandidates(string file, ClusterResult result, int limit = 3)
    {
        var componentOfFile = new Dictionary<string, string>();
        foreach (var component in result.Components)
            foreach (var f in component.Files) componentOfFile[f] = component.Id;
        var filesByComponent = result.Components.ToDictionary(c => c.Id, c => c.Files);

        var votes = new Counter();
        var neighbors = NeighborWeights(result.FileEdgeWeights);
        if (neighbors.TryGetValue(file, out var mine))
            foreach (var (other, weight) in mine.Items)
                if (componentOfFile.TryGetValue(other, out var componentId)) votes.Add(componentId, weight);

        var ranked = votes.MostCommon(limit);
        foreach (var component in result.Components)
        {
            if (ranked.Count >= limit) break;
            if (!ranked.Contains(component.Id)) ranked.Add(component.Id);
        }
        return ranked.Take(limit).Select(id => new UndeterminedCandidate(id, filesByComponent[id])).ToList();
    }
}
