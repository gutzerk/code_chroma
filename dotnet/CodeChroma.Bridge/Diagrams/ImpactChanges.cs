using System.Text.Json.Nodes;
using CodeChroma.Bridge.Engine;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;
using CodeChroma.Core.Patterns;

namespace CodeChroma.Bridge.Diagrams;

/// <summary>The Impact diagram's boxes annotated with what the diff does to each, plus the authored review (bridge/overlays.py "changes", bridge/review.py).</summary>
public static class ImpactChanges
{
    private const string Added = "added";
    private const string Modified = "modified";
    private const string Removed = "removed";

    private sealed class Block(string id, string name, string nodeId)
    {
        public string Id { get; } = id;
        public string Name { get; } = name;
        public string NodeId { get; } = nodeId;
        public List<JsonObject> Files { get; } = [];
        public List<JsonObject> Comments { get; } = [];
    }

    public static string Path(string repoRoot) => System.IO.Path.Combine(repoRoot, ".codechroma", "impact-changes.json");

    /// <summary>The authored review the skill wrote, or {} when there is none.</summary>
    public static JsonObject LoadAuthored(Workspace ws) => JsonFile.Load(Path(ws.Root)) as JsonObject ?? new JsonObject();

    /// <summary>Stable hash of the changed-file set, so a review can declare which diff it reviewed.</summary>
    public static string FingerprintFor(IEnumerable<KeyValuePair<string, string>> statuses) =>
        PatternSerialize.HashLines(statuses.Select(kv => $"{kv.Value} {kv.Key}"));

    /// <summary>Repo-relative path to status, minus the .codechroma artifacts the skills write themselves.</summary>
    private static List<KeyValuePair<string, string>> InScope(IEnumerable<KeyValuePair<string, string>> raw) =>
        raw.Where(kv => !kv.Key.Split('/').Contains(".codechroma")).ToList();

    public static JsonObject Resolve(
        Workspace ws, IOldSymbolParser parser, JsonObject impact, JsonObject? authored = null, JsonArray? reviewComments = null, JsonArray? generalComments = null)
    {
        var baseRef = ws.DiffBase();
        var tree = GitTree.Detect(ws.Root);
        var statuses = tree is null ? [] : InScope(tree.Status(baseRef).Statuses);
        var blocks = IndexNodes(impact);
        var byNodeId = new Dictionary<string, Block>();
        foreach (var block in blocks) byNodeId.TryAdd(block.NodeId, block);
        var unassigned = AttributeCards(ws, parser, byNodeId, statuses);
        var entries = unassigned.Concat(blocks.SelectMany(b => b.Files)).ToList();
        var wanted = entries.Select(e => Json.Str(e["path"]) ?? "").ToHashSet();
        var counts = tree is not null && wanted.Count > 0
            ? tree.LineCounts(baseRef, statuses.Where(s => wanted.Contains(s.Key)))
            : [];
        foreach (var entry in entries)
            if (counts.TryGetValue(Json.Str(entry["path"]) ?? "", out var lines))
            {
                entry["additions"] = lines.Additions;
                entry["deletions"] = lines.Deletions;
            }
        var comments = ResolveCommentSymbols(ws.Engine, reviewComments ?? []);
        var unassignedComments = AttributeComments(ws.Engine, comments, byNodeId);

        authored ??= new JsonObject();
        var reviewed = Json.Str(authored["fingerprint"]);
        var fingerprint = FingerprintFor(statuses);
        var byId = new Dictionary<string, Block>();
        foreach (var block in blocks) byId[block.Id] = block;
        var general = new JsonArray((generalComments ?? []).Select(c => c?.DeepClone()).Concat(unassignedComments.Select(c => (JsonNode?)c)).ToArray());

        return new JsonObject
        {
            ["fingerprint"] = fingerprint,
            ["reviewed_fingerprint"] = reviewed,
            ["has_review"] = authored.Count > 0,
            ["stale"] = authored.Count > 0 && reviewed != fingerprint,
            ["summary"] = authored["summary"] is { } summary ? summary.ToString() : "",
            ["blocks"] = MergeBlocks(blocks, authored["blocks"], ws.Engine),
            ["ghosts"] = ResolveGhosts(authored["ghosts"], byId),
            ["relationships"] = ResolveRelationships(authored["relationships"], byId.Keys.ToHashSet()),
            ["unassigned"] = new JsonArray(unassigned.Select(u => (JsonNode?)u).ToArray()),
            ["changed_file_count"] = statuses.Count,
            ["general_pr_comments"] = general,
        };
    }

    private static List<Block> IndexNodes(JsonObject impact)
    {
        var blocks = new List<Block>();
        foreach (var node in (impact["nodes"] as JsonArray ?? []).OfType<JsonObject>())
        {
            if (Json.Str(node["id"]) is not { Length: > 0 } id || Json.Str(node["node_id"]) is not { Length: > 0 } nodeId) continue;
            blocks.Add(new Block(id, node["name"] is { } name ? name.ToString() : id, nodeId));
        }
        return blocks;
    }

    /// <summary>The impact box that IS the node, or the nearest real ancestor box that collapsed it.</summary>
    private static Block? OwningBlock(string nodeId, Dictionary<string, Block> byNodeId, IGraphEngine engine)
    {
        var visited = new HashSet<string>();
        var frontier = new Queue<string>([nodeId]);
        while (frontier.Count > 0)
        {
            var current = frontier.Dequeue();
            if (!visited.Add(current)) continue;
            if (byNodeId.TryGetValue(current, out var block)) return block;
            if (engine.GetNode(current) is { } node)
                foreach (var parent in node.ParentIds) frontier.Enqueue(parent);
        }
        return null;
    }

    private static List<JsonObject> AttributeCards(Workspace ws, IOldSymbolParser parser, Dictionary<string, Block> byNodeId, List<KeyValuePair<string, string>> statuses)
    {
        var result = ChangeCards.Build(ws.Engine, ws.Root, parser, ws.DiffBase());
        var unassigned = new List<JsonObject>();
        foreach (var card in result["cards"]!.AsArray().OfType<JsonObject>())
        {
            var entry = new JsonObject { ["path"] = card["file"]!.DeepClone(), ["status"] = card["status"]!.DeepClone() };
            if (OwningBlock(Json.Str(card["node_id"])!, byNodeId, ws.Engine) is { } block) block.Files.Add(entry);
            else unassigned.Add(entry);
        }
        foreach (var item in result["unassigned"]!.AsArray().OfType<JsonObject>())
            unassigned.Add(new JsonObject { ["path"] = item["path"]!.DeepClone(), ["status"] = item["status"]!.DeepClone() });
        return unassigned;
    }

    private static List<JsonObject> ResolveCommentSymbols(IGraphEngine engine, JsonArray comments)
    {
        var resolved = new List<JsonObject>();
        foreach (var comment in comments.OfType<JsonObject>())
        {
            var copy = (JsonObject)comment.DeepClone();
            string? nodeId = null;
            if (Json.Str(comment["path"]) is { Length: > 0 } path && comment["line"] is JsonValue line && line.TryGetValue(out int lineNo))
                nodeId = engine.FunctionNodeAtLine(path, lineNo);
            copy["node_id"] = nodeId;
            copy["symbol"] = nodeId is null ? null : engine.GetSymbol(nodeId)?.QualifiedName;
            resolved.Add(copy);
        }
        return resolved;
    }

    private static List<JsonObject> AttributeComments(IGraphEngine engine, List<JsonObject> comments, Dictionary<string, Block> byNodeId)
    {
        var unassigned = new List<JsonObject>();
        foreach (var comment in comments)
        {
            var block = Json.Str(comment["node_id"]) is { Length: > 0 } nodeId ? OwningBlock(nodeId, byNodeId, engine) : null;
            if (block is null) unassigned.Add(comment);
            else block.Comments.Add(comment);
        }
        return unassigned;
    }

    /// <summary>A block is added/removed only when every changed file under it agrees; else modified.</summary>
    private static string StatusFor(List<JsonObject> files)
    {
        var kinds = files.Select(f => Json.Str(f["status"])).ToHashSet();
        if (kinds.SetEquals(["added"])) return Added;
        return kinds.SetEquals(["deleted"]) ? Removed : Modified;
    }

    private static string Text(JsonObject? entry, string key) => entry is not null && Json.Str(entry[key]) is { } text ? text : "";

    private static JsonArray MergeBlocks(List<Block> blocks, JsonNode? authoredBlocks, IGraphEngine engine)
    {
        var authored = new Dictionary<string, JsonObject>();
        foreach (var entry in (authoredBlocks as JsonArray ?? []).OfType<JsonObject>())
            if (Json.Str(entry["block"]) is { } id) authored[id] = entry;

        var merged = new JsonArray();
        foreach (var block in blocks)
        {
            authored.TryGetValue(block.Id, out var entry);
            if (block.Files.Count == 0 && block.Comments.Count == 0 && entry is null) continue;
            var status = StatusFor(block.Files);
            if (entry is not null && Json.Str(entry["status"]) is Added or Modified or Removed) status = Json.Str(entry["status"])!;
            merged.Add(new JsonObject
            {
                ["block"] = block.Id,
                ["node_id"] = block.Id,
                ["name"] = block.Name,
                ["path"] = engine.GetNode(block.NodeId)?.SourcePath,
                ["status"] = status,
                ["files"] = new JsonArray(block.Files.Select(f => (JsonNode?)f.DeepClone()).ToArray()),
                ["change_count"] = block.Files.Count,
                ["before"] = Text(entry, "before"),
                ["after"] = Text(entry, "after"),
                ["explanation"] = Text(entry, "explanation"),
                ["pr_comments"] = new JsonArray(block.Comments.Select(c => (JsonNode?)c.DeepClone()).ToArray()),
            });
        }
        return merged;
    }

    private static JsonArray ResolveGhosts(JsonNode? ghosts, Dictionary<string, Block> byId)
    {
        var resolved = new JsonArray();
        var seen = new HashSet<string>();
        foreach (var ghost in (ghosts as JsonArray ?? []).OfType<JsonObject>())
        {
            if (Json.Str(ghost["parent"]) is not { } parent || Json.Str(ghost["id"]) is not { Length: > 0 } ghostId || !byId.ContainsKey(parent)) continue;
            var nodeId = $"impact-ghost::{parent}/{ghostId}";
            if (!seen.Add(nodeId)) continue;
            resolved.Add(new JsonObject
            {
                ["id"] = ghostId,
                ["node_id"] = nodeId,
                ["parent"] = parent,
                ["parent_node_id"] = parent,
                ["name"] = ghost["name"] is { } name ? name.ToString() : ghostId,
                ["status"] = Removed,
                ["before"] = Text(ghost, "before"),
                ["after"] = Text(ghost, "after"),
                ["explanation"] = Text(ghost, "explanation"),
            });
        }
        return resolved;
    }

    private static JsonArray ResolveRelationships(JsonNode? relationships, HashSet<string> nodeIds)
    {
        var resolved = new JsonArray();
        foreach (var rel in (relationships as JsonArray ?? []).OfType<JsonObject>())
        {
            var source = Json.Str(rel["from"]);
            var target = Json.Str(rel["to"]);
            if (source is null || target is null || !nodeIds.Contains(source) || !nodeIds.Contains(target) || source == target) continue;
            var status = Json.Str(rel["status"]);
            resolved.Add(new JsonObject
            {
                ["from"] = source,
                ["to"] = target,
                ["from_node_id"] = source,
                ["to_node_id"] = target,
                ["label"] = rel["label"] is { } label ? label.ToString() : "",
                ["status"] = status is Added or Modified or Removed ? status : Modified,
                ["explanation"] = Text(rel, "explanation"),
            });
        }
        return resolved;
    }

    /// <summary>Attaches the "changes" overlay to a resolved impact diagram (boxes get inline badges, removed ones arrive as ghosts).</summary>
    public static JsonObject AttachOverlay(Workspace ws, IOldSymbolParser parser, JsonObject resolved)
    {
        var outcome = Resolve(ws, parser, resolved, LoadAuthored(ws));
        resolved["changes"] = outcome;
        resolved["ghosts"] = new JsonArray(outcome["ghosts"]!.AsArray().OfType<JsonObject>().Select(g =>
        {
            var copy = (JsonObject)g.DeepClone();
            copy["overlays"] = new JsonObject { ["changes"] = g.DeepClone() };
            return (JsonNode?)copy;
        }).ToArray());
        var byId = resolved["nodes"]!.AsArray().OfType<JsonObject>().Where(n => Json.Str(n["id"]) is not null).GroupBy(n => Json.Str(n["id"])!).ToDictionary(g => g.Key, g => g.First());
        foreach (var entry in outcome["blocks"]!.AsArray().OfType<JsonObject>())
        {
            if (!byId.TryGetValue(Json.Str(entry["node_id"])!, out var node)) continue;
            var overlays = node["overlays"] as JsonObject ?? new JsonObject();
            overlays["changes"] = entry.DeepClone();
            node["overlays"] = overlays;
        }
        return resolved;
    }

    /// <summary>The unified ReviewResult shape the shared review flow reads for the impact type.</summary>
    public static JsonObject ReviewResult(Workspace ws, IOldSymbolParser parser, string kind)
    {
        var outcome = Resolve(ws, parser, DiagramArtifacts.Load(ws, kind), LoadAuthored(ws));
        var entries = outcome["blocks"]!.AsArray().OfType<JsonObject>().Select(block => (JsonNode?)new JsonObject
        {
            ["node_id"] = block["node_id"]!.DeepClone(),
            ["explanation"] = new JsonObject
            {
                ["before"] = block["before"]!.DeepClone(),
                ["after"] = block["after"]!.DeepClone(),
                ["status"] = block["status"]!.DeepClone(),
                ["change_count"] = block["change_count"]!.DeepClone(),
            },
            ["severity"] = null,
        }).ToArray();
        return new JsonObject
        {
            ["fingerprint"] = Json.Str(outcome["reviewed_fingerprint"]) ?? "",
            ["stale"] = outcome["stale"]!.DeepClone(),
            ["has_review"] = outcome["has_review"]!.DeepClone(),
            ["summary"] = outcome["summary"]!.DeepClone(),
            ["axis"] = "explanatory",
            ["entries"] = new JsonArray(entries),
            ["ghosts"] = outcome["ghosts"]!.DeepClone(),
            ["relationships"] = outcome["relationships"]!.DeepClone(),
        };
    }
}
