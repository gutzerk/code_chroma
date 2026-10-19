using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Epics;

/// <summary>Adapts a directory of frontmatter markdown to the requirements port; listing reads frontmatter only.</summary>
public sealed class MarkdownRequirementsSource(string itemsRoot, string repoRoot) : IRequirementsSource
{
    private static readonly string[] Relations = ["depends_on", "enables"];

    /// <summary>Every *.md under the root, ordered like Python's sorted(Path.rglob): by path parts, directories before longer names.</summary>
    internal static List<string> Paths(string root)
    {
        if (!Directory.Exists(root)) return [];
        var comparer = OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;
        return Directory.EnumerateFiles(root, "*.md", SearchOption.AllDirectories)
            .OrderBy(p => Path.GetRelativePath(root, p).Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar), PartsComparer.Instance(comparer))
            .ToList();
    }

    private sealed class PartsComparer(StringComparer inner) : IComparer<string[]>
    {
        public static PartsComparer Instance(StringComparer inner) => new(inner);

        public int Compare(string[]? x, string[]? y)
        {
            for (var i = 0; i < Math.Min(x!.Length, y!.Length); i++)
                if (inner.Compare(x[i], y[i]) is var c and not 0) return c;
            return x.Length.CompareTo(y.Length);
        }
    }

    private string SourceRef(string path) => Frontmatter.RelativeSourceRef(path, repoRoot);

    private static string? StrOrNull(JsonObject data, string key) => Json.Str(data[key]);

    private static ItemRef? RefFrom(JsonObject data)
    {
        if (StrOrNull(data, "id") is not { Length: > 0 } id) return null;
        return new ItemRef(id, NonEmpty(StrOrNull(data, "title")) ?? id, StrOrNull(data, "status") ?? "", NonEmpty(StrOrNull(data, "kind")) ?? "item", StrOrNull(data, "group"));
    }

    private static string? NonEmpty(string? value) => string.IsNullOrEmpty(value) ? null : value;

    public IReadOnlyList<ItemRef> ListItems()
    {
        var seen = new HashSet<string>();
        var items = new List<ItemRef>();
        foreach (var path in Paths(itemsRoot))
        {
            var data = Frontmatter.ReadOnly(path);
            if (data is not { Count: > 0 } || RefFrom(data) is not { } reference || !seen.Add(reference.Id)) continue;
            items.Add(reference);
        }
        return items;
    }

    private (string Path, JsonObject Data, string Id)? Find(string itemId)
    {
        var folded = itemId.ToLowerInvariant();
        foreach (var path in Paths(itemsRoot))
        {
            var data = Frontmatter.ReadOnly(path);
            if (data is not null && StrOrNull(data, "id") is { } id && id.ToLowerInvariant() == folded) return (path, data, id);
        }
        return null;
    }

    private static List<ItemLink> LinksOf(JsonObject data)
    {
        var links = new List<ItemLink>();
        foreach (var relation in Relations)
            foreach (var entry in data[relation] as JsonArray ?? [])
            {
                if (entry is JsonObject o && Json.Str(o["id"]) is { } id) links.Add(new ItemLink(id, relation, Json.Str(o["title"])));
                else if (Json.Str(entry) is { } text) links.Add(new ItemLink(text, relation, null));
            }
        return links;
    }

    private List<WorkItem> ChildrenOf(string itemId)
    {
        var children = new List<WorkItem>();
        foreach (var path in Paths(itemsRoot))
        {
            var data = Frontmatter.ReadOnly(path);
            if (data is null || Json.Str(data["parent"]) != itemId || RefFrom(data) is not { } reference) continue;
            children.Add(new WorkItem(reference.Id, reference.Title, reference.Status, reference.Kind, SourceRef(path), Group: reference.Group));
        }
        return children;
    }

    public WorkItem? FetchItem(string itemId)
    {
        if (Find(itemId) is not var (path, listed, canonical)) return null;
        var sourceRef = SourceRef(path);
        try
        {
            var (data, body) = Frontmatter.Split(PyText.ReadText(path));
            return new WorkItem(
                canonical, NonEmpty(StrOrNull(data, "title")) ?? canonical, StrOrNull(data, "status") ?? "", NonEmpty(StrOrNull(data, "kind")) ?? "item", sourceRef,
                Group: StrOrNull(data, "group"), Priority: StrOrNull(data, "priority"), Url: StrOrNull(data, "url"),
                RequirementList: Frontmatter.ParseCriteria(body, sourceRef), ChildList: ChildrenOf(canonical), LinkList: LinksOf(data),
                ReferenceList: (data["references"] as JsonArray)?.Select(Json.Str).OfType<string>().ToList(),
                ContextFile: StrOrNull(data, "context_file"), Component: StrOrNull(data, "component"));
        }
        catch (Exception)
        {
            var reference = RefFrom(listed);
            return new WorkItem(canonical, reference?.Title ?? canonical, reference?.Status ?? "", reference?.Kind ?? "item", sourceRef);
        }
    }
}
