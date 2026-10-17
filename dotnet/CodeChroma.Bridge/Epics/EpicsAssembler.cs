using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Epics;

/// <summary>The requirements config limits (config.py's RequirementsConfig).</summary>
public sealed record RequirementsConfig(
    string RequirementsSourceUri = "file://plan/epics", string DeliverySourceUri = "file://specs",
    int MaxItems = 200, int MaxRequirementsPerItem = 50, int MaxStageItems = 200);

/// <summary>Merges the two ports into the index and item payloads and applies the caps.</summary>
public sealed class EpicsAssembler(IRequirementsSource? requirements, IDeliverySource? delivery, RequirementsConfig config)
{
    /// <summary>The source adapters for a workspace root; only the markdown "file" scheme exists.</summary>
    public static EpicsAssembler For(string root, RequirementsConfig? config = null)
    {
        config ??= new RequirementsConfig();
        return new EpicsAssembler(
            Resolve(config.RequirementsSourceUri, root, (items, repo) => new MarkdownRequirementsSource(items, repo)),
            Resolve(config.DeliverySourceUri, root, (items, repo) => new SpeckitDeliverySource(items, repo)), config);
    }

    private static T? Resolve<T>(string uri, string root, Func<string, string, T> factory) where T : class
    {
        var (scheme, rest) = uri.Contains("://") ? (uri[..uri.IndexOf("://", StringComparison.Ordinal)], uri[(uri.IndexOf("://", StringComparison.Ordinal) + 3)..]) : ("file", uri);
        return scheme == "file" ? factory(Path.IsPathRooted(rest) ? rest : Path.Combine(root, rest), root) : null;
    }

    /// <summary>Summaries only: it never calls FetchItem or StagesFor.</summary>
    public JsonObject Index()
    {
        var items = requirements?.ListItems() ?? [];
        var capped = items.Take(config.MaxItems).ToList();
        var groups = new JsonArray(capped.Where(i => i.Group is not null).Select(i => i.Group!).Distinct().Order(StringComparer.Ordinal).Select(g => (JsonNode?)g).ToArray());
        if (capped.Any(i => i.Group is null)) groups.Add(null);
        return new JsonObject
        {
            ["source"] = config.RequirementsSourceUri,
            ["groups"] = groups,
            ["items"] = new JsonArray(capped.Select(SerializeRef).ToArray()),
            ["omitted"] = Math.Max(items.Count - capped.Count, 0),
            ["generated_at"] = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.ffffffzzz"),
        };
    }

    /// <summary>One work item, capped and stage-attached; null for an unknown id.</summary>
    public JsonObject? Item(string itemId, string? expand = null)
    {
        if (requirements?.FetchItem(itemId) is not { } item) return null;
        var resolved = item with
        {
            RequirementList = item.Requirements.Take(config.MaxRequirementsPerItem).ToList(),
            ChildList = item.Children.Select(c => c with { StageList = StagesFor(c.Id, expand) }).ToList(),
            StageList = StagesFor(item.Id, expand),
        };
        var indexIds = HasAnyLinks(resolved) ? requirements.ListItems().Select(r => r.Id).ToHashSet() : [];
        return SerializeItem(resolved, indexIds);
    }

    private static bool HasAnyLinks(WorkItem item) => item.Links.Count > 0 || item.Children.Any(HasAnyLinks);

    private List<Stage> StagesFor(string itemId, string? expand) =>
        delivery is null ? [] : delivery.StagesFor(itemId, expand).Select(CapStage).ToList();

    private Stage CapStage(Stage stage)
    {
        if (stage.Sections.Count == 0) return stage;
        var remaining = config.MaxStageItems;
        var sections = new List<StageSection>();
        foreach (var section in stage.Sections)
        {
            if (remaining <= 0) break;
            var items = section.Items.Take(remaining).ToList();
            remaining -= items.Count;
            sections.Add(section with { Items = items });
        }
        return stage with { SectionList = sections };
    }

    private static JsonNode? Str(string? value) => value is null ? null : JsonValue.Create(value);

    private static JsonObject SerializeRef(ItemRef r) => new() { ["id"] = r.Id, ["title"] = r.Title, ["status"] = r.Status, ["kind"] = r.Kind, ["group"] = Str(r.Group) };

    private static JsonNode? Bool(bool? value) => value is null ? null : JsonValue.Create(value.Value);

    private static JsonNode? Int(int? value) => value is null ? null : JsonValue.Create(value.Value);

    private static JsonObject SerializeStageItem(StageItem i) => new()
    {
        ["id"] = i.Id, ["text"] = i.Text, ["done"] = Bool(i.Done), ["story"] = Str(i.Story), ["parallel"] = i.Parallel,
    };

    private static JsonObject SerializeStage(Stage s) => new()
    {
        ["kind"] = s.Kind, ["name"] = s.Name, ["status"] = Str(s.Status), ["done"] = Int(s.Done), ["total"] = Int(s.Total),
        ["sections"] = new JsonArray(s.Sections.Select(section => (JsonNode?)new JsonObject
        {
            ["title"] = section.Title,
            ["items"] = new JsonArray(section.Items.Select(i => (JsonNode?)SerializeStageItem(i)).ToArray()),
            ["done"] = Int(section.Done), ["total"] = Int(section.Total),
        }).ToArray()),
        ["source_ref"] = s.SourceRef,
    };

    private static JsonObject SerializeItem(WorkItem w, HashSet<string> indexIds) => new()
    {
        ["id"] = w.Id, ["title"] = w.Title, ["status"] = w.Status, ["kind"] = w.Kind, ["summary"] = w.Summary,
        ["group"] = Str(w.Group), ["priority"] = Str(w.Priority), ["source_ref"] = w.SourceRef, ["url"] = Str(w.Url),
        ["requirements"] = new JsonArray(w.Requirements.Select(r => (JsonNode?)new JsonObject
        {
            ["id"] = r.Id, ["text"] = r.Text, ["kind"] = r.Kind, ["done"] = Bool(r.Done), ["source_ref"] = r.SourceRef,
        }).ToArray()),
        ["children"] = new JsonArray(w.Children.Select(c => (JsonNode?)SerializeItem(c, indexIds)).ToArray()),
        ["links"] = new JsonArray(w.Links.Select(l => (JsonNode?)new JsonObject
        {
            ["id"] = l.Id, ["title"] = Str(l.Title), ["relation"] = l.Relation, ["in_index"] = indexIds.Contains(l.Id),
        }).ToArray()),
        ["stages"] = new JsonArray(w.Stages.Select(s => (JsonNode?)SerializeStage(s)).ToArray()),
        ["references"] = new JsonArray(w.References.Select(r => (JsonNode?)r).ToArray()),
        ["context_file"] = Str(w.ContextFile), ["component"] = Str(w.Component),
    };
}
