using System.Text.Json.Nodes;
using CodeChroma.Bridge.Engine;

namespace CodeChroma.Bridge.Diagrams;

/// <summary>Finds the repo code no authored block covers, so nothing on disk is missing from a diagram.</summary>
public static class Coverage
{
    public const int MaxUnmappedRoots = 200;

    public sealed record Uncovered(List<JsonObject> Entries, bool Truncated);

    private static bool Within(string path, string owner) => path == owner || path.StartsWith(owner + "/", StringComparison.Ordinal);

    private static bool Covers(string path, HashSet<string> paths) => paths.Any(owner => Within(path, owner));

    private static bool HasCoveredDescendant(string path, HashSet<string> paths) => paths.Any(c => c.StartsWith(path + "/", StringComparison.Ordinal));

    private static bool IsFilesystem(GraphNode node) =>
        node.Level is HierarchyLevel.System or HierarchyLevel.Pillar or HierarchyLevel.Component && !string.IsNullOrEmpty(node.SourcePath);

    /// <summary>Folders first, then files, each alphabetical.</summary>
    private static IEnumerable<GraphNode> Children(IGraphEngine engine, string id) =>
        engine.GetChildren(id).Where(IsFilesystem).OrderBy(n => n.Level == HierarchyLevel.Component).ThenBy(n => n.Name, StringComparer.Ordinal);

    public static Uncovered UncoveredRoots(IGraphEngine engine, HashSet<string> paths, int limit = MaxUnmappedRoots)
    {
        var found = new Uncovered([], false);
        var truncated = false;
        Walk(engine, IGraphEngine.RootSentinel, paths, found.Entries, limit, ref truncated);
        return found with { Truncated = truncated };
    }

    private static void Walk(IGraphEngine engine, string id, HashSet<string> paths, List<JsonObject> entries, int limit, ref bool truncated)
    {
        foreach (var child in Children(engine, id))
        {
            if (truncated) return;
            var path = child.SourcePath ?? "";
            if (Covers(path, paths)) continue;
            if (HasCoveredDescendant(path, paths))
            {
                Walk(engine, child.Id, paths, entries, limit, ref truncated);
                continue;
            }
            if (entries.Count >= limit) { truncated = true; return; }
            entries.Add(new JsonObject
            {
                ["node_id"] = child.Id, ["path"] = path, ["name"] = child.Name,
                ["level"] = child.Level == HierarchyLevel.Component ? "file" : "folder",
            });
        }
    }

    private static IEnumerable<string> FilePaths(IGraphEngine engine, string id)
    {
        foreach (var child in Children(engine, id))
        {
            if (child.Level == HierarchyLevel.Component) yield return child.SourcePath!;
            foreach (var path in FilePaths(engine, child.Id)) yield return path;
        }
    }

    private static bool IsConfigPath(string path) => path.Split('/').Any(s => s.StartsWith('.'));

    /// <summary>How much of the repo the authored blocks account for, counted in files; dot-directories are scored out.</summary>
    public static JsonObject Report(IGraphEngine engine, HashSet<string> paths, int limit = MaxUnmappedRoots)
    {
        var found = UncoveredRoots(engine, paths, limit);
        var files = FilePaths(engine, IGraphEngine.RootSentinel).Distinct().Where(p => !IsConfigPath(p)).ToList();
        var entries = found.Entries.Where(e => !IsConfigPath(e["path"]!.GetValue<string>())).ToList();
        var covered = files.Count(p => Covers(p, paths));
        var counted = entries.Select(e => (JsonObject)e.DeepClone()).ToList();
        foreach (var entry in counted) entry["file_count"] = 0;
        var byPath = counted.ToDictionary(e => e["path"]!.GetValue<string>());
        foreach (var file in files)
        {
            var candidate = file;
            while (candidate.Length > 0)
            {
                if (byPath.TryGetValue(candidate, out var owner)) { owner["file_count"] = owner["file_count"]!.GetValue<int>() + 1; break; }
                var slash = candidate.LastIndexOf('/');
                candidate = slash < 0 ? "" : candidate[..slash];
            }
        }
        return new JsonObject
        {
            ["total_files"] = files.Count, ["covered_files"] = covered, ["unmapped_files"] = files.Count - covered,
            ["percent"] = files.Count == 0 ? 100 : covered * 100 / files.Count,
            ["entries"] = new JsonArray(counted.Select(e => (JsonNode?)e).ToArray()), ["truncated"] = found.Truncated,
        };
    }
}
