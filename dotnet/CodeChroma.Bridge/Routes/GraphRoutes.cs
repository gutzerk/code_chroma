using System.Text.Json.Nodes;
using CodeChroma.Bridge.Engine;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Workspaces;
using CoreDependencyDigest = CodeChroma.Core.DependencyDigest;
using CoreDependencyIndex = CodeChroma.Core.DependencyIndex;
using CoreContextDigest = CodeChroma.Core.ContextDigest;

namespace CodeChroma.Bridge.Routes;

/// <summary>The hierarchy itself: node refs, children, connections, structure and source slices.</summary>
public static class GraphRoutes
{
    public const string RootNodeId = "root";

    private static readonly HashSet<HierarchyLevel> FilesystemLevels = [HierarchyLevel.System, HierarchyLevel.Pillar, HierarchyLevel.Component];

    public static void Map(WebApplication app)
    {
        app.MapGet("/repos/{repoId}/structure", Structure);
        app.MapGet("/repos/{repoId}/source", Source);
        app.MapGet("/repos/{repoId}/dependency-digest", DependencyDigestRoute);
        app.MapGet("/repos/{repoId}/context-digest", ContextDigestRoute);
        app.MapGet("/repos/{repoId}/route", RouteBetween);
        app.MapGet("/repos/{repoId}/nodes/{**rest}", Nodes);
    }

    private static string LevelName(HierarchyLevel level) => level switch
    {
        HierarchyLevel.System or HierarchyLevel.Pillar => "folder",
        HierarchyLevel.Component => "file",
        HierarchyLevel.Service => "class",
        _ => "function",
    };

    private static IResult Detail(int status, string message) =>
        Results.Json(new ErrorDetail(message), BridgeJson.Default.ErrorDetail, statusCode: status);

    private static IReadOnlyList<GraphNode> VisibleChildren(Workspace ws, string nodeId)
    {
        if (nodeId != IGraphEngine.RootSentinel && ws.Engine.GetNode(nodeId)?.Level == HierarchyLevel.Function) return [];
        return ws.Engine.GetChildren(nodeId).Where(c => c.Level != HierarchyLevel.Code).ToList();
    }

    private static (string? Source, string? Language) NodeSource(Workspace ws, GraphNode node, Dictionary<string, string?> cache)
    {
        string? Cached(string path)
        {
            if (!cache.TryGetValue(path, out var text)) cache[path] = text = SourceText.Read(Path.Combine(ws.Root, path));
            return text;
        }

        if (node.Level == HierarchyLevel.Component)
            return node.SourcePath is null ? (null, null) : (Cached(node.SourcePath), SourceText.LanguageFor(node.SourcePath));
        if (node.Level is HierarchyLevel.Service or HierarchyLevel.Function)
        {
            var symbol = ws.Engine.GetSymbol(node.Id);
            if (symbol is null || node.SourcePath is null) return (null, null);
            var text = Cached(node.SourcePath);
            return text is null ? (null, null) : (SourceText.SliceLines(text, symbol.StartLine, symbol.EndLine), symbol.Language);
        }
        return (null, null);
    }

    private static NodeRef ToRef(Workspace ws, GraphNode node, Dictionary<string, string?> cache)
    {
        var children = VisibleChildren(ws, node.Id);
        var (source, language) = NodeSource(ws, node, cache);
        return new NodeRef(
            node.Id, node.Name, LevelName(node.Level), node.ParentIds.Count > 0 ? node.ParentIds[0] : RootNodeId,
            children.Count > 0, children.Count, source, language, node.DocOnly);
    }

    private static IResult Nodes(string repoId, string rest, WorkspaceRegistry registry)
    {
        var ws = registry.Get(repoId);
        if (rest.EndsWith("/children", StringComparison.Ordinal))
        {
            var id = rest[..^"/children".Length];
            var cache = new Dictionary<string, string?>();
            var parent = id == RootNodeId ? IGraphEngine.RootSentinel : id;
            return Results.Json(VisibleChildren(ws, parent).Select(c => ToRef(ws, c, cache)).ToList(), BridgeJson.Default.ListNodeRef);
        }
        if (rest.EndsWith("/connections", StringComparison.Ordinal))
        {
            var id = rest[..^"/connections".Length];
            var connections = ws.Engine.GetDependencies(id)
                .Select(d => new Connection(id, d.Id, "depends_on", EdgeOrigin(ws, id)))
                .Concat(ws.Engine.GetDependents(id).Select(d => new Connection(d.Id, id, "depended_on_by", EdgeOrigin(ws, d.Id))))
                .ToList();
            return Results.Json(connections, BridgeJson.Default.ListConnection);
        }
        if (rest == RootNodeId)
        {
            var children = VisibleChildren(ws, IGraphEngine.RootSentinel);
            return Results.Json(
                new RootRef(RootNodeId, Path.GetFileName(ws.Root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)), "folder", null, children.Count > 0, children.Count),
                BridgeJson.Default.RootRef);
        }
        var node = ws.Engine.GetNode(rest);
        // A real 404, not 200/null: a null body reads identically to "hasn't arrived yet" client-side.
        if (node is null || node.Level == HierarchyLevel.Code) return Detail(404, $"unknown node: {rest}");
        return Results.Json(ToRef(ws, node, []), BridgeJson.Default.NodeRef);
    }

    private static string? EdgeOrigin(Workspace ws, string fromId) =>
        ws.Engine.GetSymbol(fromId) is { } symbol ? $"{symbol.FilePath}:{symbol.StartLine}" : null;

    private static IResult Source(string repoId, string path, int? start, int? end, WorkspaceRegistry registry)
    {
        var ws = registry.Get(repoId);
        var text = SourceText.ReadWithin(ws.Root, Path.Combine(ws.Root, path));
        if (text is null) return Detail(404, $"unknown file: {path}");
        var content = start is null && end is null ? text : SourceText.SliceLines(text, start ?? 1, end);
        return Results.Json(new SourceFragment(path, content, SourceText.LanguageFor(path)), BridgeJson.Default.SourceFragment);
    }

    // --- digests and dependency routes, all built fresh from the engine's graph snapshot ---

    private static IResult DependencyDigestRoute(string repoId, WorkspaceRegistry registry, string? path = null)
    {
        var ws = registry.Get(repoId);
        ws.Sync();
        if (ws.Engine.GraphSnapshot() is not { } graph) return Detail(404, "this engine has no graph snapshot");
        var digest = CoreDependencyDigest.Build(graph);
        if (path is null) return Reply.Json(digest);
        var entry = digest["files"]!.AsArray().FirstOrDefault(f => (string?)f?["path"] == path);
        return entry is null ? Detail(404, $"no digest entry for path '{path}'") : Reply.Json(entry);
    }

    private static IResult ContextDigestRoute(string repoId, WorkspaceRegistry registry)
    {
        var ws = registry.Get(repoId);
        if (ws.Engine.GraphSnapshot() is not { } graph) return Detail(404, "this engine has no graph snapshot");
        return Reply.Json(CoreContextDigest.Build(graph, ws.Root));
    }

    private static IResult RouteBetween(string repoId, HttpRequest request, WorkspaceRegistry registry)
    {
        var ws = registry.Get(repoId);
        string from = request.Query["from"], to = request.Query["to"];
        if (string.IsNullOrEmpty(from) || string.IsNullOrEmpty(to)) return Detail(422, "query parameters 'from' and 'to' are required");
        if (ws.Engine.GraphSnapshot() is not { } graph) return Detail(404, "this engine has no graph snapshot");
        var path = new CoreDependencyIndex(graph).FindRoute(from, to);
        return Reply.Json(new JsonObject { ["path"] = path is null ? null : new JsonArray(path.Select(p => (JsonNode?)JsonValue.Create(p)).ToArray()) });
    }

    // --- structure: a bounded folder/file tree with real node ids ---

    private sealed class Budget(int remaining)
    {
        public int Remaining { get; set; } = remaining;
        public bool Truncated { get; set; }
    }

    private static int Clamp(int value, int cap) => Math.Max(1, Math.Min(value, cap));

    private static IResult Structure(string repoId, WorkspaceRegistry registry, string root = RootNodeId, int? depth = null, int? max_children = null, int? max_nodes = null)
    {
        var ws = registry.Get(repoId);
        ws.Sync();
        var engine = ws.Engine;
        var d = Clamp(depth ?? BridgeLimits.StructureDefaultDepth, BridgeLimits.StructureMaxDepth);
        var perParent = Clamp(max_children ?? BridgeLimits.StructureDefaultMaxChildren, BridgeLimits.StructureMaxChildren);
        var budget = new Budget(Clamp(max_nodes ?? BridgeLimits.StructureDefaultMaxNodes, BridgeLimits.StructureMaxNodes));
        string parentId;
        if (root is "" or RootNodeId or IGraphEngine.RootSentinel) parentId = IGraphEngine.RootSentinel;
        else if (engine.GetNode(root) is null) return Detail(404, $"no graph node for root '{root}'");
        else parentId = root;

        var top = Take(engine, null, FsChildren(engine, parentId), perParent, budget);
        var queue = new Queue<(StructureEntry Entry, GraphNode Node, int Level)>(top.Select(t => (t.Entry, t.Node, 1)));
        while (queue.Count > 0)
        {
            var (entry, node, level) = queue.Dequeue();
            if (node.Level == HierarchyLevel.Component) continue;
            var children = FsChildren(engine, node.Id);
            entry.ChildCount = children.Count;
            if (children.Count == 0) continue;
            if (level >= d)
            {
                entry.Truncated = budget.Truncated = true;
                continue;
            }
            var taken = Take(engine, entry, children, perParent, budget);
            if (taken.Count > 0) entry.Children = taken.Select(t => t.Entry).ToList();
            foreach (var t in taken) queue.Enqueue((t.Entry, t.Node, level + 1));
        }
        return Results.Json(new StructureResponse(root, d, budget.Truncated, top.Select(t => t.Entry).ToList()), BridgeJson.Default.StructureResponse);
    }

    private static List<GraphNode> FsChildren(IGraphEngine engine, string id) =>
        engine.GetChildren(id)
            .Where(c => FilesystemLevels.Contains(c.Level))
            .OrderBy(c => c.Level == HierarchyLevel.Component).ThenBy(c => c.Name, StringComparer.Ordinal)
            .ToList();

    private static List<(StructureEntry Entry, GraphNode Node)> Take(IGraphEngine engine, StructureEntry? parent, List<GraphNode> nodes, int maxChildren, Budget budget)
    {
        var taken = new List<(StructureEntry, GraphNode)>();
        foreach (var node in nodes.Take(maxChildren))
        {
            if (budget.Remaining == 0) break;
            budget.Remaining--;
            taken.Add((new StructureEntry
            {
                NodeId = node.Id,
                Path = node.SourcePath ?? node.Name,
                Name = node.Name,
                Level = node.Level == HierarchyLevel.Component ? "file" : "folder",
                Summary = ShortSummary(engine, node.Id),
                DocOnly = node.DocOnly,
            }, node));
        }
        if (taken.Count < nodes.Count)
        {
            budget.Truncated = true;
            if (parent is not null) parent.Truncated = true;
        }
        return taken;
    }

    private static string? ShortSummary(IGraphEngine engine, string id)
    {
        var text = engine.SummaryText(id)?.Trim();
        if (string.IsNullOrEmpty(text)) return null;
        var cut = text.IndexOf(". ", StringComparison.Ordinal);
        var head = (cut < 0 ? text : text[..cut]).TrimEnd('.');
        var sentence = head + ".";
        return sentence.Length > BridgeLimits.StructureSummaryChars ? sentence[..BridgeLimits.StructureSummaryChars] : sentence;
    }
}
