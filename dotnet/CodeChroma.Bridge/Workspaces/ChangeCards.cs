using System.Text.Json.Nodes;
using CodeChroma.Bridge.Engine;
using CodeChroma.Bridge.Routes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Workspaces;

/// <summary>Resolves a (file, symbol) target to the nearest existing graph node (plan_resolver.py).</summary>
public static class PlanResolver
{
    public const string RootNodeId = "root";

    /// <summary>The node id and resolution ("exact" | "parent" | "ancestor") of the nearest existing ancestor.</summary>
    public static (string NodeId, string Resolution) ResolveTarget(IGraphEngine engine, string filePath, string? symbol)
    {
        if (!string.IsNullOrEmpty(symbol))
        {
            foreach (var candidate in new[] { $"{filePath}::function::{symbol}", $"{filePath}::class::{symbol}" })
                if (engine.GetNode(candidate) is { } exact) return (exact.Id, "exact");
            if (symbol.Contains('.'))
            {
                var classId = $"{filePath}::class::{symbol[..symbol.LastIndexOf('.')]}";
                if (engine.GetNode(classId) is { } parentClass) return (parentClass.Id, "parent");
            }
        }
        if (engine.GetNode($"component::{filePath}") is { } component) return (component.Id, string.IsNullOrEmpty(symbol) ? "exact" : "parent");
        foreach (var dir in DirChain(filePath))
            if (engine.GetNode($"dir::{dir}") is { } directory) return (directory.Id, "ancestor");
        // A brand-new top-level dir has no folder node; anchor to any root node, else root.
        var systems = engine.GetChildren(IGraphEngine.RootSentinel);
        return (systems.Count > 0 ? systems[0].Id : RootNodeId, "ancestor");
    }

    /// <summary>Ancestor directory paths of filePath, nearest (deepest) first.</summary>
    private static List<string> DirChain(string filePath)
    {
        var parts = filePath.Split('/').SkipLast(1).ToArray();
        return Enumerable.Range(0, parts.Length).Select(i => string.Join('/', parts.Take(i + 1))).Reverse().ToList();
    }
}

/// <summary>One card per changed symbol, pinned to the nearest existing block, so a diff reads as a map.</summary>
public static class ChangeCards
{
    private const string ReasonBinary = "binary";
    private const string ReasonNoNode = "no-node";
    private const string ReasonUnparsed = "unparsed-node-id";

    private static string Kind(string status) => status switch { "added" => "add", "deleted" => "delete", _ => "modify" };

    private static string Verb(string status) => status switch { "added" => "Added", "modified" => "Modified", "deleted" => "Deleted", _ => "Changed" };

    /// <summary>Every change vs `baseRef` on the nearest node.</summary>
    public static JsonObject Build(IGraphEngine engine, string repoRoot, IOldSymbolParser parser, string baseRef = "HEAD")
    {
        var tree = GitTree.Detect(repoRoot);
        if (tree is null) return Payload(baseRef, false, [], []);
        var resolved = GitRunner.Run(repoRoot, "rev-parse", "--verify", "--quiet", baseRef)?.Trim();
        // An unreachable base makes the status report nothing, which would read as "no change".
        if (string.IsNullOrEmpty(resolved)) return Payload(baseRef, false, [], []);

        var statuses = InScope(tree.Status(baseRef).Statuses);
        var (cards, unassigned) = SymbolCards(engine, repoRoot, parser, baseRef);
        var covered = cards.Select(card => card["file"]!.GetValue<string>()).ToHashSet();
        var (fileCards, fileUnassigned) = FileCards(engine, tree, baseRef, statuses, covered);
        return Payload(resolved, true, [.. cards, .. fileCards], [.. unassigned, .. fileUnassigned]);
    }

    private static JsonObject Payload(string baseRef, bool baseResolved, List<JsonObject> cards, List<JsonObject> unassigned)
    {
        var byNode = new JsonObject();
        foreach (var card in cards)
        {
            var id = card["node_id"]!.GetValue<string>();
            byNode[id] = (byNode[id]?.GetValue<int>() ?? 0) + 1;
        }
        return new JsonObject
        {
            ["base"] = baseRef,
            ["base_resolved"] = baseResolved,
            ["card_count"] = cards.Count,
            ["cards"] = new JsonArray(cards.Cast<JsonNode?>().ToArray()),
            ["by_node"] = byNode,
            ["by_node_status"] = ByNodeStatus(cards),
            ["unassigned"] = new JsonArray(unassigned.Cast<JsonNode?>().ToArray()),
        };
    }

    /// <summary>The plain hierarchy view's block-recolor signal: added/modified/removed per changed node.</summary>
    private static JsonObject ByNodeStatus(List<JsonObject> cards)
    {
        var kinds = new InsertionMap<HashSet<string>>();
        foreach (var card in cards)
        {
            var id = card["node_id"]!.GetValue<string>();
            if (!kinds.TryGetValue(id, out var set)) kinds[id] = set = [];
            set.Add(card["status"]!.GetValue<string>());
        }
        var result = new JsonObject();
        foreach (var (id, set) in kinds)
            result[id] = set.SetEquals(["added"]) ? "added" : set.SetEquals(["deleted"]) ? "removed" : "modified";
        return result;
    }

    /// <summary>Drops paths the analysis walk never visited, so no card can point outside the graph.</summary>
    private static List<KeyValuePair<string, string>> InScope(InsertionMap<string> statuses) =>
        statuses.Where(kv => !kv.Key.Split('/').Any(BridgeLimits.IgnoredDirs.Contains)).ToList();

    /// <summary>`(file, symbol)` a diff entry's node id spells, or (null, null) for an unfamiliar shape.</summary>
    private static (string? File, string? Symbol) SplitNodeId(string nodeId)
    {
        foreach (var marker in new[] { "::function::", "::class::" })
        {
            var index = nodeId.IndexOf(marker, StringComparison.Ordinal);
            if (index >= 0) return (nodeId[..index], nodeId[(index + marker.Length)..]);
        }
        return nodeId.StartsWith("component::", StringComparison.Ordinal) ? (nodeId["component::".Length..], null) : (null, null);
    }

    private static (List<JsonObject> Cards, List<JsonObject> Unassigned) SymbolCards(IGraphEngine engine, string repoRoot, IOldSymbolParser parser, string baseRef)
    {
        var cards = new List<JsonObject>();
        var unassigned = new List<JsonObject>();
        foreach (var entry in FunctionDiffs.Compute(engine, repoRoot, parser, baseRef))
        {
            var nodeId = entry["node_id"]!.GetValue<string>();
            var status = entry["status"]!.GetValue<string>();
            var (file, symbol) = SplitNodeId(nodeId);
            if (file is null)
            {
                unassigned.Add(Unassigned(nodeId, status, ReasonUnparsed));
                continue;
            }
            var (added, removed) = LineDiff.Delta(entry["original_source"]!.GetValue<string>(), entry["proposed_source"]!.GetValue<string>());
            var card = Card(engine, nodeId, file, symbol, entry["name"]!.GetValue<string>(), entry["level"]!.GetValue<string>(), status, added, removed, false);
            if (card is null) unassigned.Add(Unassigned(file, status, ReasonNoNode));
            else cards.Add(card);
        }
        return (cards, unassigned);
    }

    private static (List<JsonObject> Cards, List<JsonObject> Unassigned) FileCards(
        IGraphEngine engine, GitTree tree, string baseRef, List<KeyValuePair<string, string>> statuses, HashSet<string> covered)
    {
        var cards = new List<JsonObject>();
        var unassigned = new List<JsonObject>();
        foreach (var (filePath, status) in statuses.Where(kv => !covered.Contains(kv.Key)).OrderBy(kv => kv.Key, StringComparer.Ordinal))
        {
            var (added, removed, binary) = FileLineDelta(tree, filePath, baseRef, status);
            var card = Card(engine, filePath, filePath, null, Path.GetFileName(filePath), "file", status, added, removed, binary);
            if (card is null) unassigned.Add(Unassigned(filePath, status, ReasonNoNode));
            else cards.Add(card);
        }
        return (cards, unassigned);
    }

    private static JsonObject? Card(
        IGraphEngine engine, string cardId, string file, string? symbol, string name, string target, string status, int added, int removed, bool binary)
    {
        var (nodeId, resolution) = PlanResolver.ResolveTarget(engine, file, symbol);
        // The ladder's root fallback can name a node an empty graph never had: report, don't pin.
        if (engine.GetNode(nodeId) is null) return null;
        return new JsonObject
        {
            ["id"] = cardId,
            ["text"] = $"{Verb(status)} {name}",
            ["details"] = "",
            ["node_id"] = nodeId,
            ["kind"] = Kind(status),
            ["resolution"] = resolution,
            ["file"] = file,
            ["symbol"] = symbol,
            ["name"] = name,
            ["target"] = target,
            ["status"] = status,
            ["added_lines"] = added,
            ["removed_lines"] = removed,
            ["binary"] = binary,
        };
    }

    private static JsonObject Unassigned(string path, string status, string reason) => new() { ["path"] = path, ["status"] = status, ["reason"] = reason };

    /// <summary>Line counts for a whole-file change, plus whether it is binary and so has none to report.</summary>
    private static (int Added, int Removed, bool Binary) FileLineDelta(GitTree tree, string filePath, string baseRef, string status)
    {
        var oldBytes = tree.HeadContent(filePath, baseRef);
        string original;
        try
        {
            original = oldBytes.Length > 0 ? new System.Text.UTF8Encoding(false, true).GetString(oldBytes) : "";
        }
        catch (System.Text.DecoderFallbackException)
        {
            return (0, 0, true);
        }
        var proposed = status == "deleted" ? "" : SourceText.Read(Path.Combine(tree.RepoRoot, filePath));
        if (proposed is null) return (0, 0, true);
        var (added, removed) = LineDiff.Delta(original, proposed);
        return (added, removed, false);
    }
}
