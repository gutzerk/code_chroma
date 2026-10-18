using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Epics;

namespace CodeChroma.Bridge.Skills;

/// <summary>The just-written wiki-general tree's self-check, in process (check_wiki_general.py): exit 0 OK, 1 FAILED, 2 ERROR.</summary>
public static partial class WikiGeneralCheck
{
    [GeneratedRegex(@"^\s*-\s+(?:File|Class|Function):\s+`([^`]+)`\s*$", RegexOptions.Multiline)]
    private static partial Regex RefRe();

    [GeneratedRegex(@"^\s*-\s+Connects:\s+`([^`]+)`\s*$", RegexOptions.Multiline)]
    private static partial Regex ConnectsRe();

    [GeneratedRegex(@"\[[^\]]+\]\(([^)#]+)(?:#[^)]*)?\)")]
    private static partial Regex LinkRe();

    private sealed class Report
    {
        public List<string> Broken { get; } = [];
        public List<string> Advisory { get; } = [];
        public int PagesChecked { get; set; }
        public int RefsChecked { get; set; }
    }

    private static string? Text(JsonNode? node) => node is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    private static string? Id(JsonObject entry) => Text(entry["id"]);

    private static string? PathOf(JsonObject entry) => Text(entry["path"]);

    private static List<JsonObject> AsList(JsonNode? value) => value is JsonArray array ? array.OfType<JsonObject>().ToList() : [];

    private static string Repr(string? text) => text is null ? "None" : $"'{text}'";

    /// <summary>The whole check minus argv and printing; fetchGaps returns the subset of paths the plain wiki has no page for.</summary>
    public static (int ExitCode, List<string> Lines) Run(string wikiDir, Func<IReadOnlyList<string>, ISet<string>> fetchGaps)
    {
        var manifestPath = Path.Combine(wikiDir, "manifest.json");
        JsonNode? manifest;
        try
        {
            manifest = JsonNode.Parse(PyText.ReadText(manifestPath));
        }
        catch (JsonException error)
        {
            return (2, [$"ERROR {manifestPath} is not valid JSON: {error.Message}"]);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return (2, [$"ERROR could not read {manifestPath}: {error.Message}"]);
        }
        if (manifest is not JsonObject root) return (2, [$"ERROR {manifestPath} is not valid JSON: expected an object"]);

        var report = new Report();
        var containers = AsList(root["containers"]);
        var components = AsList(root["components"]);
        var edges = AsList(root["edges"]);
        CheckUniqueIds(containers, "container", report);
        CheckUniqueIds(components, "component", report);
        var containerIds = containers.Select(Id).OfType<string>().ToHashSet();
        CheckMembership(components, containerIds, report);
        CheckContainersNonEmpty(containers, components, report);
        CheckConnects(wikiDir, containers.Concat(components), edges, report);

        var refs = new HashSet<string>();
        var entries = new List<(string Path, string Kind)> { (Path.Combine(wikiDir, "index.md"), "root") };
        entries.AddRange(PageEntries(wikiDir, containers, "c2"));
        entries.AddRange(PageEntries(wikiDir, components, "c3"));
        foreach (var (path, kind) in entries) refs.UnionWith(CheckPage(path, kind, report));

        CheckLinks(wikiDir, Path.Combine(wikiDir, "index.md"), TargetPaths(wikiDir, containers), "root", report);
        foreach (var container in containers)
        {
            if (PathOf(container) is not { } cPath) continue;
            var owned = components.Where(c => Text(c["container"]) is { } owner && owner == Id(container)).ToList();
            CheckLinks(wikiDir, Path.Combine(wikiDir, cPath), TargetPaths(wikiDir, owned), $"container {Repr(Id(container))}", report);
        }

        try
        {
            CheckRefsResolve(fetchGaps, refs, report);
        }
        catch (Exception error) when (error is IOException or JsonException or HttpRequestException)
        {
            return (2, [$"ERROR could not verify wiki-context references: {error.Message}"]);
        }

        if (report.Broken.Count > 0)
            return (1, [.. report.Broken, $"FAILED {report.Broken.Count} issue(s) -- see lines above"]);
        return (0, [.. report.Advisory, $"OK: {report.PagesChecked} page(s), {report.RefsChecked} code reference(s) resolved"]);
    }

    private static void CheckUniqueIds(List<JsonObject> entries, string noun, Report report)
    {
        var seen = new SortedDictionary<string, int>(StringComparer.Ordinal);
        foreach (var id in entries.Select(Id).OfType<string>()) seen[id] = seen.GetValueOrDefault(id) + 1;
        foreach (var (id, count) in seen)
            if (count > 1) report.Broken.Add($"DUPLICATE {noun} id {Repr(id)} used {count} times");
    }

    private static void CheckMembership(List<JsonObject> components, HashSet<string> containerIds, Report report)
    {
        foreach (var component in components)
        {
            var container = Text(component["container"]);
            if (container is null || !containerIds.Contains(container))
                report.Broken.Add($"DANGLING component {Repr(Id(component))} names container {Repr(container)}, which does not exist");
        }
    }

    private static void CheckContainersNonEmpty(List<JsonObject> containers, List<JsonObject> components, Report report)
    {
        var owned = components.Select(c => Text(c["container"])).ToHashSet();
        foreach (var container in containers)
            if (!owned.Contains(Id(container))) report.Broken.Add($"EMPTY-CONTAINER {Repr(Id(container))} has no components");
    }

    private static IEnumerable<(string, string)> PageEntries(string wikiDir, List<JsonObject> entries, string subdir) =>
        entries.Select(PathOf).OfType<string>().Select(p => (Path.Combine(wikiDir, p), subdir));

    private static HashSet<string> TargetPaths(string wikiDir, IEnumerable<JsonObject> entries) =>
        entries.Select(PathOf).OfType<string>().Select(p => Path.GetFullPath(Path.Combine(wikiDir, p))).ToHashSet();

    private static string? ReadPage(string path)
    {
        try { return PyText.ReadText(path); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Text.DecoderFallbackException) { return null; }
    }

    // Advisory: every container and component should be reachable by a click from its parent page.
    private static void CheckLinks(string wikiDir, string page, HashSet<string> expected, string label, Report report)
    {
        if (ReadPage(page) is not { } text) return;
        var pageDirectory = Path.GetDirectoryName(page)!;
        var linked = LinkRe().Matches(text).Select(m => Path.GetFullPath(Path.Combine(pageDirectory, m.Groups[1].Value))).ToHashSet();
        foreach (var target in expected.Where(t => !linked.Contains(t)).OrderBy(t => t, StringComparer.Ordinal))
            report.Advisory.Add($"LINK-MISSING {label} page never links to {Path.GetRelativePath(wikiDir, target).Replace('\\', '/')}");
    }

    private static Dictionary<string, HashSet<string>> ConnectsNeighbors(List<JsonObject> edges)
    {
        var neighbors = new Dictionary<string, HashSet<string>>();
        foreach (var edge in edges)
        {
            if (Text(edge["from"]) is not { } from || Text(edge["to"]) is not { } to) continue;
            if (!neighbors.TryGetValue(from, out var a)) neighbors[from] = a = [];
            if (!neighbors.TryGetValue(to, out var b)) neighbors[to] = b = [];
            a.Add(to);
            b.Add(from);
        }
        return neighbors;
    }

    // One-way: a claimed Connects: target with no matching edges[] entry fails; omission is fine.
    private static void CheckConnects(string wikiDir, IEnumerable<JsonObject> entries, List<JsonObject> edges, Report report)
    {
        var neighbors = ConnectsNeighbors(edges);
        foreach (var entry in entries)
        {
            if (Id(entry) is not { } id || PathOf(entry) is not { } path || ReadPage(Path.Combine(wikiDir, path)) is not { } text) continue;
            var known = neighbors.GetValueOrDefault(id) ?? [];
            var claimed = ConnectsRe().Matches(text).Select(m => m.Groups[1].Value).ToHashSet();
            foreach (var target in claimed.Where(c => !known.Contains(c)).OrderBy(c => c, StringComparer.Ordinal))
                report.Broken.Add($"CONNECTS-INVALID {Repr(id)} claims a connection to {Repr(target)}, which has no matching edges[] entry");
        }
    }

    private static HashSet<string> CheckPage(string path, string kind, Report report)
    {
        if (ReadPage(path) is not { } text)
        {
            report.Broken.Add($"MISSING-PAGE {kind} page {path} does not exist");
            return [];
        }
        report.PagesChecked++;
        return RefRe().Matches(text).Select(m => m.Groups[1].Value).ToHashSet();
    }

    private static void CheckRefsResolve(Func<IReadOnlyList<string>, ISet<string>> fetchGaps, HashSet<string> refs, Report report)
    {
        var paths = refs.Select(r => r.Split("::", 2)[0]).Distinct().Order(StringComparer.Ordinal).ToList();
        if (paths.Count == 0) return;
        var gaps = fetchGaps(paths);
        report.RefsChecked += paths.Count - paths.Count(gaps.Contains);
        foreach (var path in paths.Where(gaps.Contains))
            report.Broken.Add($"HALLUCINATED {Repr(path)} matches no page in .codechroma/wiki/");
    }
}
