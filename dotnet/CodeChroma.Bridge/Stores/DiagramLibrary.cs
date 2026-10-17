using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace CodeChroma.Bridge.Stores;

/// <summary>The cross-project library of user-authored diagram types, one JSON file per type (diagrams/library.py).</summary>
public sealed class DiagramLibrary(UserPaths paths)
{
    private static readonly string[] Directions = ["TB", "LR"];
    private static readonly string[] CheckShapes = ["hierarchical", "flat"];

    private static readonly Regex TypeId = new(
        LlmCatalog.Data["custom_diagrams"]!["type_id_pattern"]!.GetValue<string>().TrimEnd('$') + @"\z", RegexOptions.CultureInvariant);

    private static readonly int MaxTypes = LlmCatalog.Data["custom_diagrams"]!["max_types"]!.GetValue<int>();

    public static IReadOnlyList<string> StyleIds { get; } = LlmCatalog.Data["diagram_styles"]!.AsArray().Select(s => s!["id"]!.GetValue<string>()).ToList();

    public static bool ValidTypeId(string typeId) => TypeId.IsMatch(typeId);

    private string TypePath(string typeId) => Path.Combine(paths.DiagramTypes, typeId + ".json");

    public JsonArray ListTypes()
    {
        var summaries = new JsonArray();
        if (!Directory.Exists(paths.DiagramTypes)) return summaries;
        foreach (var file in Directory.GetFiles(paths.DiagramTypes, "*.json").Order(StringComparer.Ordinal))
        {
            if (JsonFile.Load(file) is not JsonObject data || Json.Str(data["id"]) is not { } id) continue;
            summaries.Add(new JsonObject
            {
                ["id"] = id,
                ["title"] = data.ContainsKey("title") ? data["title"]?.DeepClone() : id,
                ["description"] = data.ContainsKey("description") ? data["description"]?.DeepClone() : "",
                ["style"] = data["style"]?.DeepClone(),
            });
        }
        return summaries;
    }

    public JsonObject? LoadType(string typeId) =>
        ValidTypeId(typeId) && JsonFile.Load(TypePath(typeId)) is JsonObject { Count: > 0 } data && Json.Str(data["id"]) == typeId ? data : null;

    public bool DeleteType(string typeId)
    {
        if (!ValidTypeId(typeId) || !File.Exists(TypePath(typeId))) return false;
        File.Delete(TypePath(typeId));
        return true;
    }

    public List<string> Validate(JsonObject definition)
    {
        var problems = new List<string>();
        if (Json.Str(definition["id"]) is not { } id || !ValidTypeId(id))
            problems.Add($"id must match '{LlmCatalog.Data["custom_diagrams"]!["type_id_pattern"]!.GetValue<string>()}'");
        if (Json.Str(definition["title"]) is not { } title || Json.IsBlank(title)) problems.Add("title is required");
        if (!(definition["style"] is JsonObject || Json.Str(definition["style"]) is { } style && StyleIds.Contains(style)))
            problems.Add($"style must be one of {ProviderStore.PyList(StyleIds.Order(StringComparer.Ordinal))} or an inline style object");
        if (Json.Str(definition["instructions"]) is not { } instructions || Json.IsBlank(instructions)) problems.Add("instructions is required");
        if (!(definition["layout"] is JsonObject layout && Json.Str(layout["direction"]) is { } direction && Directions.Contains(direction)))
            problems.Add($"layout must have direction one of {ProviderStore.PyTuple(Directions)}");
        if (!(definition["grouping"] is JsonObject grouping && grouping["enabled"] is JsonValue enabled && enabled.TryGetValue(out bool _)))
            problems.Add("grouping must be an object with a boolean 'enabled'");
        if (!(definition["relation_kinds"] is JsonArray kinds && kinds.All(k => k is JsonObject o && Json.Str(o["id"]) is { } kid && !Json.IsBlank(kid))))
            problems.Add("relation_kinds must be a list of {'id': str, 'label': str} objects");
        if (definition["addons"] is JsonObject addons && !addons.All(kv => kv.Value is JsonValue v && v.TryGetValue(out bool _)))
            problems.Add("addons must be an object of booleans");
        var overlays = definition.ContainsKey("overlays") ? definition["overlays"] : new JsonArray();
        var knownOverlays = LlmCatalog.Strings("overlay_providers");
        if (!(overlays is JsonArray list && list.All(o => Json.Str(o) is { } name && knownOverlays.Contains(name))))
            problems.Add("overlays must be a list of registered overlay names");
        var context = definition["context"];
        if (!(context is null || Json.Str(context) is { } provider && LlmCatalog.Strings("context_providers").Contains(provider)))
            problems.Add("context must be null or a registered context provider name");
        var checks = definition["checks"];
        if (!(checks is null || checks is JsonObject c && Json.Str(c["shape"]) is { } shape && CheckShapes.Contains(shape)))
            problems.Add($"checks.shape must be one of {ProviderStore.PyTuple(CheckShapes)}");
        var review = definition["review"];
        if (!(review is null || review is JsonObject r && Json.Str(r["axis"]) == "explanatory" && Json.Str(r["agent_factory"]) == "impact-changes"
            && LlmCatalog.Strings("review_agents").Contains("impact-changes")))
            problems.Add("review must be null or an object with a known axis and agent_factory");
        return problems;
    }

    public JsonObject Save(JsonObject definition)
    {
        var problems = Validate(definition);
        var typeId = Json.Str(definition["id"]);
        var existing = typeId is null ? null : LoadType(typeId);
        var count = Directory.Exists(paths.DiagramTypes) ? Directory.GetFiles(paths.DiagramTypes, "*.json").Length : 0;
        if (existing is null && count >= MaxTypes) problems.Add($"library already holds {MaxTypes} types");
        if (problems.Count > 0) throw new ArgumentException(string.Join("; ", problems));
        var now = DateTimeOffset.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.ffffffzzz");
        var stamped = (JsonObject)definition.DeepClone();
        stamped["schema_version"] = definition.ContainsKey("schema_version") ? definition["schema_version"]?.DeepClone() : 1;
        stamped["created_at"] = existing is null ? now : existing["created_at"]?.DeepClone();
        stamped["updated_at"] = now;
        JsonFile.Write(TypePath(typeId!), stamped);
        return stamped;
    }
}
