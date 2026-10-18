using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Core.Patterns;
using FileGroup = CodeChroma.Core.DependencyDigest.FileSymbolsView;

namespace CodeChroma.Core.Wiki;

/// <summary>One file or folder's content hash; a Merkle tree over the hierarchy gives a one-comparison freshness check (wiki/hashtree.py).</summary>
public sealed class HashNode(string path, string hash, SortedDictionary<string, HashNode>? children = null)
{
    public string Path { get; } = path;
    public string Hash { get; } = hash;
    public SortedDictionary<string, HashNode> Children { get; } = children ?? new SortedDictionary<string, HashNode>(StringComparer.Ordinal);
}

public static class WikiHashTree
{
    public const string FileName = ".hashtree.json";

    private static string HashChildren(SortedDictionary<string, HashNode> children) =>
        PatternSerialize.HashLines(children.Select(kv => $"{kv.Key}:{kv.Value.Hash}"));

    private static HashNode BuildNode(HierarchyNode node, Dictionary<string, List<HierarchyNode>> childrenMap, string repoRoot)
    {
        var path = node.SourcePath ?? node.Name;
        if (node.Level == HierarchyLevel.Component)
        {
            try
            {
                return new HashNode(path, Convert.ToHexString(SHA1.HashData(File.ReadAllBytes(System.IO.Path.Combine(repoRoot, path)))).ToLowerInvariant());
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                // Deleted on disk since the last reanalyze: a stable sentinel hash, not a crash.
                return new HashNode(path, "missing");
            }
        }
        var children = new SortedDictionary<string, HashNode>(StringComparer.Ordinal);
        foreach (var child in (childrenMap.GetValueOrDefault(node.Id) ?? []).OrderBy(n => n.Name, StringComparer.Ordinal))
            children[child.Name] = BuildNode(child, childrenMap, repoRoot);
        return new HashNode(path, HashChildren(children), children);
    }

    public static HashNode Build(Graph graph, string repoRoot, Dictionary<string, List<HierarchyNode>>? childrenMap = null)
    {
        childrenMap ??= WikiGenerator.ChildrenByParent(graph);
        var children = new SortedDictionary<string, HashNode>(StringComparer.Ordinal);
        foreach (var folder in graph.NodeList.Where(n => n.Level == HierarchyLevel.System).OrderBy(n => n.Name, StringComparer.Ordinal))
            children[folder.Name] = BuildNode(folder, childrenMap, repoRoot);
        return new HashNode("", HashChildren(children), children);
    }

    private static IEnumerable<string> AllPaths(HashNode node)
    {
        if (node.Path.Length > 0) yield return node.Path;
        foreach (var child in node.Children.Values)
            foreach (var path in AllPaths(child)) yield return path;
    }

    /// <summary>Paths whose hash changed since <paramref name="old"/> (every path when there is no prior state).</summary>
    public static List<string> Diff(HashNode? old, HashNode @new)
    {
        if (old is null) return AllPaths(@new).ToList();
        if (old.Hash == @new.Hash) return [];
        if (old.Children.Count == 0 && @new.Children.Count == 0) return [@new.Path];
        var changed = new List<string>();
        foreach (var name in old.Children.Keys.Union(@new.Children.Keys).Order(StringComparer.Ordinal))
        {
            old.Children.TryGetValue(name, out var oldChild);
            @new.Children.TryGetValue(name, out var newChild);
            if (oldChild is null) changed.Add(newChild!.Path);
            else if (newChild is null) changed.Add(oldChild.Path);
            else if (oldChild.Hash != newChild.Hash) changed.AddRange(Diff(oldChild, newChild));
        }
        return changed;
    }

    private static JsonObject ToJson(HashNode node)
    {
        var children = new JsonObject();
        foreach (var (name, child) in node.Children) children[name] = ToJson(child);
        return new JsonObject { ["path"] = node.Path, ["hash"] = node.Hash, ["children"] = children };
    }

    private static HashNode FromJson(JsonObject data)
    {
        var children = new SortedDictionary<string, HashNode>(StringComparer.Ordinal);
        foreach (var (name, child) in data["children"] as JsonObject ?? [])
            children[name] = FromJson((JsonObject)child!);
        return new HashNode(data["path"]!.GetValue<string>(), data["hash"]!.GetValue<string>(), children);
    }

    public static HashNode? LoadPrevious(string outputDir)
    {
        try
        {
            return JsonNode.Parse(File.ReadAllText(System.IO.Path.Combine(outputDir, FileName))) is JsonObject data ? FromJson(data) : null;
        }
        catch (Exception error) when (error is IOException or JsonException or InvalidCastException or NullReferenceException or FormatException)
        {
            return null;
        }
    }

    public static void Persist(string outputDir, HashNode tree) =>
        WikiGenerator.WriteTextFile(System.IO.Path.Combine(outputDir, FileName), ToJson(tree).ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
}

/// <summary>Rewrites what changed since the last sync, or the whole wiki on the first run (wiki/sync.py).</summary>
public static class WikiSync
{
    private static List<string> AncestorFolderPaths(string path, Dictionary<string, HierarchyNode> nodesByPath)
    {
        var ancestors = new List<string>();
        var current = path;
        while (true)
        {
            var slash = current.LastIndexOf('/');
            if (slash < 0) break;
            current = current[..slash];
            if (nodesByPath.ContainsKey(current)) ancestors.Add(current);
        }
        return ancestors;
    }

    private static void DeleteRemovedPage(string path, string outputDir)
    {
        var filePage = System.IO.Path.Combine(outputDir, "files", WikiGenerator.FilePageRelativePath(path));
        if (File.Exists(filePage)) File.Delete(filePage);
        var folderDir = System.IO.Path.Combine(outputDir, "files", path);
        if (Directory.Exists(folderDir)) Directory.Delete(folderDir, true);
    }

    private static List<string> WriteFolderSubtree(HierarchyNode folder, Dictionary<string, List<HierarchyNode>> childrenMap, Dictionary<string, FileGroup> filesByPath, string outputDir)
    {
        var pages = WikiGenerator.WriteFolderPage(folder, childrenMap, filesByPath, outputDir);
        foreach (var child in (childrenMap.GetValueOrDefault(folder.Id) ?? []).OrderBy(n => n.Name, StringComparer.Ordinal))
        {
            if (child.Level == HierarchyLevel.Component)
            {
                if (filesByPath.TryGetValue(child.SourcePath ?? "", out var group)) pages.Add(WikiGenerator.WriteFilePage(group, outputDir));
            }
            else
            {
                pages.AddRange(WriteFolderSubtree(child, childrenMap, filesByPath, outputDir));
            }
        }
        return pages;
    }

    private static WikiSyncResult SyncPartial(Graph graph, string repoRoot, string outputDir, List<string> changed, Dictionary<string, List<HierarchyNode>> childrenMap)
    {
        var filesByPath = DependencyDigest.GroupByFile(graph);
        var nodesByPath = new Dictionary<string, HierarchyNode>();
        foreach (var node in graph.NodeList)
            if (!string.IsNullOrEmpty(node.SourcePath)) nodesByPath[node.SourcePath] = node;

        var regenerated = new List<string>();
        var foldersToWrite = new HashSet<string>();
        foreach (var path in changed)
        {
            nodesByPath.TryGetValue(path, out var node);
            if (filesByPath.TryGetValue(path, out var group)) regenerated.Add(WikiGenerator.WriteFilePage(group, outputDir));
            else if (node is { Level: HierarchyLevel.System or HierarchyLevel.Pillar }) regenerated.AddRange(WriteFolderSubtree(node, childrenMap, filesByPath, outputDir));
            else DeleteRemovedPage(path, outputDir);
            foldersToWrite.UnionWith(AncestorFolderPaths(path, nodesByPath));
        }
        foreach (var folderPath in foldersToWrite.Order(StringComparer.Ordinal))
            if (nodesByPath.TryGetValue(folderPath, out var folder)) regenerated.AddRange(WikiGenerator.WriteFolderPage(folder, childrenMap, filesByPath, outputDir));

        regenerated.Add(WikiGenerator.WriteRootPage(graph, repoRoot, outputDir));
        WikiGenerator.WriteGapReports(WikiGenerator.ComputeGaps(filesByPath), outputDir);
        return new WikiSyncResult(changed.Distinct().Order(StringComparer.Ordinal).ToList(), regenerated, false);
    }

    /// <summary>Regenerates only what changed since the last sync, or the whole wiki on a first run.</summary>
    public static WikiSyncResult Sync(Graph graph, string repoRoot, string outputDir)
    {
        var old = WikiHashTree.LoadPrevious(outputDir);
        var childrenMap = WikiGenerator.ChildrenByParent(graph);
        if (old is null)
        {
            var filesByPath = DependencyDigest.GroupByFile(graph);
            var result = WikiGenerator.Generate(graph, repoRoot, outputDir, childrenMap, filesByPath);
            WikiHashTree.Persist(outputDir, WikiHashTree.Build(graph, repoRoot, childrenMap));
            return new WikiSyncResult(filesByPath.Keys.Order(StringComparer.Ordinal).ToList(), result.Pages, true);
        }

        var tree = WikiHashTree.Build(graph, repoRoot, childrenMap);
        var changed = WikiHashTree.Diff(old, tree);
        if (changed.Count == 0) return new WikiSyncResult([], [], false);
        var partial = SyncPartial(graph, repoRoot, outputDir, changed, childrenMap);
        WikiHashTree.Persist(outputDir, tree);
        return partial;
    }
}
