namespace CodeChroma.Core;

/// <summary>A depth- and budget-bounded folder/file tree with real node ids, for an AI assistant to copy paths from.</summary>
public static class StructureBuilder
{
    private const int DefaultDepth = 2, DefaultMaxChildren = 40, DefaultMaxNodes = 300;
    private const int MaxDepth = 5, MaxChildren = 200, MaxNodes = 1000, SummaryChars = 160;
    private static readonly string[] RootAliases = ["", "root", Graph.RootSentinel];

    private sealed class Budget(int remaining)
    {
        public int Remaining { get; set; } = remaining;
        public bool Truncated { get; set; }
    }

    public static StructureResult Build(Graph graph, StructureOptions? options = null)
    {
        options ??= new StructureOptions();
        var depth = Clamp(options.Depth ?? DefaultDepth, MaxDepth);
        var maxChildren = Clamp(options.MaxChildren ?? DefaultMaxChildren, MaxChildren);
        var budget = new Budget(Clamp(options.MaxNodes ?? DefaultMaxNodes, MaxNodes));
        var parentId = ResolveRoot(graph, options.RootId);
        var nodes = Walk(graph, VisibleChildren(graph, parentId), depth, maxChildren, budget);
        return new StructureResult(options.RootId, depth, budget.Truncated, nodes);
    }

    private static int Clamp(int value, int cap) => Math.Max(1, Math.Min(value, cap));

    private static string ResolveRoot(Graph graph, string rootId)
    {
        if (RootAliases.Contains(rootId)) return Graph.RootSentinel;
        if (!graph.Nodes.ContainsKey(rootId)) throw new UnknownRootException(rootId);
        return rootId;
    }

    /// <summary>Breadth-first so a spent budget costs depth rather than whole branches.</summary>
    private static List<StructureEntry> Walk(Graph graph, List<HierarchyNode> roots, int depth, int maxChildren, Budget budget)
    {
        var top = Take(graph, null, roots, maxChildren, budget);
        var queue = new Queue<(StructureEntry Entry, HierarchyNode Node, int Level)>(top.Select(t => (t.Entry, t.Node, 1)));
        while (queue.Count > 0)
        {
            var (entry, node, level) = queue.Dequeue();
            if (node.Level == HierarchyLevel.Component) continue;
            var children = VisibleChildren(graph, node.Id);
            entry.ChildCount = children.Count;
            if (children.Count == 0) continue;
            if (level >= depth)
            {
                entry.Truncated = budget.Truncated = true;
                continue;
            }
            var taken = Take(graph, entry, children, maxChildren, budget);
            if (taken.Count > 0) entry.Children = taken.Select(t => t.Entry).ToList();
            foreach (var (childEntry, child) in taken) queue.Enqueue((childEntry, child, level + 1));
        }
        return top.Select(t => t.Entry).ToList();
    }

    /// <summary>Entries for as many nodes as the caps allow, flagging the parent if any were dropped.</summary>
    private static List<(StructureEntry Entry, HierarchyNode Node)> Take(
        Graph graph,
        StructureEntry? parent, List<HierarchyNode> nodes, int maxChildren, Budget budget)
    {
        var taken = new List<(StructureEntry, HierarchyNode)>();
        foreach (var node in nodes.Take(maxChildren))
        {
            if (budget.Remaining == 0) break;
            budget.Remaining--;
            taken.Add((MakeEntry(graph, node), node));
        }
        if (taken.Count < nodes.Count)
        {
            budget.Truncated = true;
            if (parent is not null) parent.Truncated = true;
        }
        return taken;
    }

    private static StructureEntry MakeEntry(Graph graph, HierarchyNode node) => new()
    {
        NodeId = node.Id,
        Path = node.SourcePath ?? node.Name,
        Name = node.Name,
        Level = node.Level == HierarchyLevel.Component ? "file" : "folder",
        Summary = ShortSummary(graph.Summaries.GetValueOrDefault(node.Id)),
        DocOnly = node.DocOnly,
    };

    /// <summary>Folders first, then files, each alphabetical: a stable order the agent can read down.</summary>
    private static List<HierarchyNode> VisibleChildren(Graph graph, string nodeId) =>
        graph.ChildrenOf(nodeId)
            .Where(c => c.Level is HierarchyLevel.System or HierarchyLevel.Pillar or HierarchyLevel.Component)
            .OrderBy(c => c.Level == HierarchyLevel.Component).ThenBy(c => c.Name, StringComparer.Ordinal)
            .ToList();

    internal static string? ShortSummary(string? text)
    {
        if (text is null || text.Trim().Length == 0) return null;
        var trimmed = text.Trim();
        var cut = trimmed.IndexOf(". ", StringComparison.Ordinal);
        var head = (cut < 0 ? trimmed : trimmed[..cut]).TrimEnd('.');
        var sentence = head + ".";
        return sentence.Length > SummaryChars ? sentence[..SummaryChars] : sentence;
    }
}
