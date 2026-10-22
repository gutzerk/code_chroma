using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;
using CodeChroma.Core;
using CodeChroma.Core.Wiki;

namespace CodeChroma.Bridge.Skills;

/// <summary>The Update route's deterministic half: re-cluster, diff against the stored manifest, apply every deletion (wiki_general_agent.py).</summary>
public static partial class WikiGeneralUpdate
{
    [GeneratedRegex(@"^.*\[[^\]]+\]\(([^)#]+)(?:#[^)]*)?\).*\n?", RegexOptions.Multiline)]
    private static partial Regex LinkLineRe();

    private static string? Text(JsonNode? node) => node is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    private static List<JsonObject> DictList(JsonNode? value) => value is JsonArray array ? array.OfType<JsonObject>().ToList() : [];

    private static HashSet<string> EntryIds(List<JsonObject> entries) => entries.Select(e => Text(e["id"])).OfType<string>().ToHashSet();

    private static JsonArray Strings(IEnumerable<string> values) => new(values.Select(v => (JsonNode?)v).ToArray());

    private static List<string> SortedFiles(IEnumerable<string> files) => files.Order(StringComparer.Ordinal).ToList();

    private static Dictionary<string, List<string>> FilesByOldId(List<JsonObject> entries)
    {
        var result = new Dictionary<string, List<string>>();
        foreach (var entry in entries)
            if (Text(entry["id"]) is { } id && entry["files"] is JsonArray files) result[id] = files.Select(Text).OfType<string>().ToList();
        return result;
    }

    // Neighbor map restricted to valid ids, so a same-named component and container stay apart.
    private static Dictionary<string, HashSet<string>> NeighborsFromEdges(List<JsonObject> edges, HashSet<string> validIds)
    {
        var neighbors = new Dictionary<string, HashSet<string>>();
        foreach (var edge in edges)
        {
            if (Text(edge["from"]) is not { } from || Text(edge["to"]) is not { } to || !validIds.Contains(from) || !validIds.Contains(to)) continue;
            if (!neighbors.TryGetValue(from, out var a)) neighbors[from] = a = [];
            if (!neighbors.TryGetValue(to, out var b)) neighbors[to] = b = [];
            a.Add(to);
            b.Add(from);
        }
        return neighbors;
    }

    // The old id most of the files used to belong to; null when empty or tied (Created wins ties).
    private static string? BestMatchingOldId(IEnumerable<string> files, Dictionary<string, string> oldIdByFile)
    {
        var votes = new Dictionary<string, int>();
        foreach (var file in files)
            if (oldIdByFile.TryGetValue(file, out var oldId)) votes[oldId] = votes.GetValueOrDefault(oldId) + 1;
        return Clustering.PluralityWinner(votes);
    }

    private sealed record LevelResult(JsonObject Delta, Dictionary<string, string> Resolved);

    // data-model.md's Update state machine for one level.
    private static LevelResult DiffLevel(
        List<(string Id, IReadOnlyList<string> Files)> freshGroups, List<JsonObject> oldEntries,
        Dictionary<string, HashSet<string>> oldNeighbors, List<(string, string)> freshEdges, HashSet<string> usedIds, bool topLevel)
    {
        // Every old id, even a files[]-less one (predates the feature), must count as superseded.
        var oldIds = EntryIds(oldEntries);
        var oldFilesById = FilesByOldId(oldEntries);
        var oldIdByFile = new Dictionary<string, string>();
        foreach (var (oldId, files) in oldFilesById)
            foreach (var file in files) oldIdByFile[file] = oldId;

        var resolved = new Dictionary<string, string>();
        var matchedOldIds = new HashSet<string>();
        var unmatched = new List<(string Id, IReadOnlyList<string> Files)>();
        foreach (var (internalId, files) in freshGroups)
        {
            if (BestMatchingOldId(files, oldIdByFile) is { } match)
            {
                resolved[internalId] = match;
                matchedOldIds.Add(match);
            }
            else unmatched.Add((internalId, files));
        }

        // A superseded old id is free again, so a new group may reuse it instead of getting a "-2".
        usedIds.ExceptWith(oldIds.Except(matchedOldIds));
        var created = new List<JsonObject>();
        foreach (var (internalId, files) in unmatched)
        {
            var (baseId, newName) = WikiGeneralNaming.DeterministicName(files, topLevel);
            var newId = WikiGeneralNaming.DedupeId(baseId, usedIds);
            usedIds.Add(newId);
            resolved[internalId] = newId;
            created.Add(new JsonObject
            {
                ["id"] = newId, ["name"] = WikiGeneralNaming.UniqueDisplay(newName, baseId, newId),
                ["files"] = Strings(SortedFiles(files)), ["internal_id"] = internalId,
            });
        }

        var freshNeighborsReal = new Dictionary<string, HashSet<string>>();
        foreach (var (a, b) in freshEdges)
        {
            if (!resolved.TryGetValue(a, out var ra) || !resolved.TryGetValue(b, out var rb)) continue;
            if (!freshNeighborsReal.TryGetValue(ra, out var setA)) freshNeighborsReal[ra] = setA = [];
            if (!freshNeighborsReal.TryGetValue(rb, out var setB)) freshNeighborsReal[rb] = setB = [];
            setA.Add(rb);
            setB.Add(ra);
        }

        var filesByInternal = freshGroups.ToDictionary(g => g.Id, g => g.Files);
        var unaffected = new List<string>();
        var rewritten = new List<JsonObject>();
        foreach (var (internalId, realId) in resolved)
        {
            if (!matchedOldIds.Contains(realId)) continue;
            var files = filesByInternal[internalId];
            var sameFiles = SortedFiles(files).SequenceEqual(SortedFiles(oldFilesById.GetValueOrDefault(realId) ?? []));
            var sameNeighbors = (freshNeighborsReal.GetValueOrDefault(realId) ?? []).SetEquals(oldNeighbors.GetValueOrDefault(realId) ?? []);
            if (sameFiles && sameNeighbors) unaffected.Add(realId);
            else rewritten.Add(new JsonObject { ["id"] = realId, ["files"] = Strings(SortedFiles(files)), ["internal_id"] = internalId });
        }

        JsonArray ById(IEnumerable<JsonObject> entries) => new(entries.OrderBy(e => Text(e["id"]), StringComparer.Ordinal).Select(e => (JsonNode?)e).ToArray());
        var delta = new JsonObject
        {
            ["unaffected"] = Strings(unaffected.Order(StringComparer.Ordinal)),
            ["rewritten"] = ById(rewritten),
            ["created"] = ById(created),
            ["deleted"] = Strings(oldIds.Except(matchedOldIds).Order(StringComparer.Ordinal)),
        };
        return new LevelResult(delta, resolved);
    }

    private static JsonArray TranslateEdges(IReadOnlyList<ClusterEdge> edges, Dictionary<string, string> resolved)
    {
        var aggregated = Clustering.AggregateEdgeList(resolved, edges.Select(e => (e.FromId, e.ToId, e.Count)));
        return new JsonArray(aggregated
            .OrderBy(kv => kv.Key.Item1, StringComparer.Ordinal).ThenBy(kv => kv.Key.Item2, StringComparer.Ordinal)
            .Select(kv => (JsonNode?)new JsonObject { ["from"] = kv.Key.Item1, ["to"] = kv.Key.Item2, ["count"] = kv.Value }).ToArray());
    }

    /// <summary>The full Update delta: components then containers, using the first pass's resolved real ids.</summary>
    public static JsonObject DiffManifest(ClusterResult fresh, JsonObject oldManifest)
    {
        var oldComponents = DictList(oldManifest["components"]);
        var oldContainers = DictList(oldManifest["containers"]);
        var oldEdges = DictList(oldManifest["edges"]);
        // Persisted edges mix both levels; per-level id filtering stops a same-named id colliding.
        var usedComponentIds = EntryIds(oldComponents);
        var usedContainerIds = EntryIds(oldContainers);
        var oldComponentNeighbors = NeighborsFromEdges(oldEdges, usedComponentIds);
        var oldContainerNeighbors = NeighborsFromEdges(oldEdges, usedContainerIds);

        var componentGroups = fresh.Components.Select(c => (c.Id, c.Files)).ToList();
        var componentEdges = fresh.ComponentEdges.Select(e => (e.FromId, e.ToId)).ToList();
        var component = DiffLevel(componentGroups, oldComponents, oldComponentNeighbors, componentEdges, usedComponentIds, topLevel: false);

        var containerFiles = new List<(string Id, List<string> Files)>();
        foreach (var c in fresh.Components)
        {
            var index = containerFiles.FindIndex(e => e.Id == c.ContainerId);
            if (index < 0) containerFiles.Add((c.ContainerId, [.. c.Files]));
            else containerFiles[index].Files.AddRange(c.Files);
        }
        var containerGroups = containerFiles.Select(e => (e.Id, (IReadOnlyList<string>)e.Files)).ToList();
        var containerEdges = fresh.ContainerEdges.Select(e => (e.FromId, e.ToId)).ToList();
        var container = DiffLevel(containerGroups, oldContainers, oldContainerNeighbors, containerEdges, usedContainerIds, topLevel: true);

        var containerOf = fresh.Components.ToDictionary(c => c.Id, c => container.Resolved[c.ContainerId]);
        foreach (var entry in DictList(component.Delta["created"]).Concat(DictList(component.Delta["rewritten"])))
        {
            entry["container"] = containerOf[Text(entry["internal_id"])!];
            entry.Remove("internal_id");
        }
        foreach (var entry in DictList(container.Delta["created"]).Concat(DictList(container.Delta["rewritten"]))) entry.Remove("internal_id");

        var edges = TranslateEdges(fresh.ComponentEdges, component.Resolved);
        foreach (var edge in TranslateEdges(fresh.ContainerEdges, container.Resolved)) edges.Add(edge!.DeepClone());
        return new JsonObject { ["components"] = component.Delta, ["containers"] = container.Delta, ["edges"] = edges };
    }

    /// <summary>Recomputes clustering fresh, then diffs it against the stored manifest's state machine.</summary>
    public static JsonObject ComputeDelta(Workspace ws)
    {
        // Must reflect right-now, not whenever the watcher last ran.
        ws.Sync();
        var fresh = ws.Engine.BuildClusters(ws.Root) ?? throw new InvalidOperationException("the engine has no graph to cluster");
        var old = JsonFile.Load(WikiGeneral.ManifestPath(ws.Root)) as JsonObject ?? new JsonObject();
        return DiffManifest(fresh, old);
    }

    // The one markdown link line in the parent pointing at the target, removed if present.
    private static void StripLinkTo(string parentPath, string targetPath)
    {
        string text;
        try { text = Epics.PyText.ReadText(parentPath); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return; }
        var target = Path.GetFullPath(targetPath);
        var parentDirectory = Path.GetDirectoryName(parentPath)!;
        var updated = LinkLineRe().Replace(text, match =>
            Path.GetFullPath(Path.Combine(parentDirectory, match.Groups[1].Value)) == target ? "" : match.Value);
        if (updated != text) WikiGenerator.WriteTextFile(parentPath, updated);
    }

    // wikiDir/relative, or null if it escapes: manifest paths are model-written.
    private static string? ConfinedPath(string wikiDir, string relative)
    {
        var candidate = Path.GetFullPath(Path.Combine(wikiDir, relative));
        var root = Path.GetFullPath(wikiDir).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        return candidate.StartsWith(root, OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal) ? candidate : null;
    }

    private static void DeleteEntry(string wikiDir, JsonObject entry, string? parentPath)
    {
        if (Text(entry["path"]) is not { } path || ConfinedPath(wikiDir, path) is not { } pagePath) return;
        if (parentPath is not null) StripLinkTo(parentPath, pagePath);
        try { File.Delete(pagePath); } catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
    }

    private static HashSet<string> IdSet(JsonNode? list) => list is JsonArray array ? array.Select(Text).OfType<string>().ToHashSet() : [];

    /// <summary>Applies every Deleted entry and refreshes files[] for Rewritten and Created; page text is not touched.</summary>
    public static JsonObject ApplyDelta(Workspace ws, JsonObject delta)
    {
        var wikiDir = WikiGeneral.Dir(ws.Root);
        var manifestPath = WikiGeneral.ManifestPath(ws.Root);
        var manifest = JsonFile.Load(manifestPath) as JsonObject ?? new JsonObject { ["containers"] = new JsonArray(), ["components"] = new JsonArray() };
        var containers = DictList(manifest["containers"]);
        var components = DictList(manifest["components"]);
        var containersById = containers.Where(c => Text(c["id"]) is not null).GroupBy(c => Text(c["id"])!).ToDictionary(g => g.Key, g => g.Last());
        var componentDelta = (JsonObject)delta["components"]!;
        var containerDelta = (JsonObject)delta["containers"]!;
        var deletedComponents = IdSet(componentDelta["deleted"]);
        var deletedContainers = IdSet(containerDelta["deleted"]);

        foreach (var component in components.Where(c => deletedComponents.Contains(Text(c["id"]) ?? "")))
        {
            var parent = Text(component["container"]) is { } owner ? containersById.GetValueOrDefault(owner) : null;
            var parentPage = parent is null ? null : Text(parent["path"]);
            DeleteEntry(wikiDir, component, parentPage is null ? null : ConfinedPath(wikiDir, parentPage));
        }
        components = components.Where(c => !deletedComponents.Contains(Text(c["id"]) ?? "")).ToList();

        foreach (var container in containers.Where(c => deletedContainers.Contains(Text(c["id"]) ?? "")))
            DeleteEntry(wikiDir, container, Path.Combine(wikiDir, "index.md"));
        containers = containers.Where(c => !deletedContainers.Contains(Text(c["id"]) ?? "")).ToList();

        var componentsById = components.Where(c => Text(c["id"]) is not null).GroupBy(c => Text(c["id"])!).ToDictionary(g => g.Key, g => g.Last());
        foreach (var entry in DictList(componentDelta["rewritten"]))
        {
            if (!componentsById.TryGetValue(Text(entry["id"])!, out var existing)) continue;
            existing["files"] = entry["files"]!.DeepClone();
            existing["container"] = entry["container"]!.DeepClone();
        }
        foreach (var entry in DictList(componentDelta["created"]))
            components.Add(new JsonObject
            {
                ["id"] = Text(entry["id"]), ["name"] = Text(entry["name"]), ["container"] = Text(entry["container"]),
                ["path"] = $"c3/{Text(entry["id"])}.md", ["files"] = entry["files"]!.DeepClone(),
            });

        var containersByIdNow = containers.Where(c => Text(c["id"]) is not null).GroupBy(c => Text(c["id"])!).ToDictionary(g => g.Key, g => g.Last());
        foreach (var entry in DictList(containerDelta["rewritten"]))
            if (containersByIdNow.TryGetValue(Text(entry["id"])!, out var existing)) existing["files"] = entry["files"]!.DeepClone();
        foreach (var entry in DictList(containerDelta["created"]))
            containers.Add(new JsonObject
            {
                ["id"] = Text(entry["id"]), ["name"] = Text(entry["name"]),
                ["path"] = $"c2/{Text(entry["id"])}.md", ["files"] = entry["files"]!.DeepClone(),
            });

        manifest["containers"] = new JsonArray(containers.Select(c => (JsonNode?)c.DeepClone()).ToArray());
        manifest["components"] = new JsonArray(components.Select(c => (JsonNode?)c.DeepClone()).ToArray());
        manifest["edges"] = delta["edges"]!.DeepClone();
        manifest["generated_at"] = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.ffffff'+00:00'", System.Globalization.CultureInfo.InvariantCulture);
        JsonFile.Write(manifestPath, manifest);
        return delta;
    }

    /// <summary>The pages a run was told to write: created and rewritten components then containers, as wiki-relative paths.</summary>
    public static List<string> PagesToWrite(JsonObject delta)
    {
        var pages = new List<string>();
        foreach (var entry in DictList(delta["components"]!["created"]).Concat(DictList(delta["components"]!["rewritten"])))
            if (Text(entry["id"]) is { } id) pages.Add($"c3/{id}.md");
        foreach (var entry in DictList(delta["containers"]!["created"]).Concat(DictList(delta["containers"]!["rewritten"])))
            if (Text(entry["id"]) is { } id) pages.Add($"c2/{id}.md");
        return pages;
    }

    /// <summary>An error message when the run left a promised page missing or wrote nothing at all, else null (an exit code alone proves nothing).</summary>
    public static string? VerifyPagesWritten(string root, IReadOnlyList<string> pages, DateTime startedUtc)
    {
        if (pages.Count == 0) return null;
        var wikiDir = WikiGeneral.Dir(root);
        var missing = pages.Where(page => !File.Exists(Path.Combine(wikiDir, page))).ToList();
        if (missing.Count > 0)
            return $"update finished but did not write {missing.Count} of {pages.Count} page(s): {string.Join(", ", missing.Take(5))}{(missing.Count > 5 ? ", ..." : "")}";
        var touched = pages.Any(page => File.GetLastWriteTimeUtc(Path.Combine(wikiDir, page)) >= startedUtc);
        return touched ? null : $"update finished but wrote none of the {pages.Count} page(s) it was asked to refresh";
    }

    /// <summary>The GET .../clustering body: the fixed grouping Phase A consumes, never invents.</summary>
    public static JsonObject ClusteringBody(ClusterResult result)
    {
        JsonArray Edges(IReadOnlyList<ClusterEdge> edges) => new(edges.Select(e => (JsonNode?)new JsonObject { ["from"] = e.FromId, ["to"] = e.ToId, ["count"] = e.Count }).ToArray());
        var candidates = new JsonObject();
        foreach (var file in result.UndeterminedFiles)
            candidates[file] = new JsonArray(Clustering.UndeterminedCandidates(file, result)
                .Select(c => (JsonNode?)new JsonObject { ["id"] = c.Id, ["files"] = Strings(c.Files) }).ToArray());
        return new JsonObject
        {
            ["components"] = new JsonArray(result.Components.Select(c => (JsonNode?)new JsonObject { ["id"] = c.Id, ["files"] = Strings(c.Files) }).ToArray()),
            ["containers"] = new JsonArray(result.Containers.Select(c => (JsonNode?)new JsonObject { ["id"] = c.Id, ["component_ids"] = Strings(c.ComponentIds) }).ToArray()),
            ["component_edges"] = Edges(result.ComponentEdges),
            ["container_edges"] = Edges(result.ContainerEdges),
            ["undetermined_files"] = Strings(result.UndeterminedFiles),
            ["undetermined_candidates"] = candidates,
        };
    }
}
