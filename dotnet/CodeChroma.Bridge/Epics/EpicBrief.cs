using System.Text.Json.Nodes;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Epics;

/// <summary>The per-epic AI brief: schema normalization, the prompt bundle, the tasks.md splice and the runner spec.</summary>
public static class EpicBrief
{
    public const string TimeoutEnvVar = "codechroma_EPIC_BRIEF_TIMEOUT_SECONDS";

    public static string BriefsDir(string repoRoot) => Path.Combine(repoRoot, ".codechroma", "epics", "briefs");

    public static string JobKey(string workspaceId, string epicId) => $"{workspaceId}:{epicId}";

    /// <summary>Where the skill writes: one file per epic, named by the item half of the job key.</summary>
    public static string BriefPath(string repoRoot, string key) => Path.Combine(BriefsDir(repoRoot), SkillAgent.ItemFromKey(key) + ".json");

    public static bool HasValidBrief(JsonNode? data) => data is JsonObject o && o["scope"] is JsonArray;

    public static SkillAgentSpec Spec() => new(
        "epic_brief_agent", Prompts.Render("epic_brief_agent"), SkillTimeouts.Model,
        (root, key) => BriefPath(root, key), HasValidBrief, TimeoutEnvVar, SkillTimeouts.For("epic-brief"),
        "brief generation produced no valid scope");

    // -- bundle (everything the skill needs, injected into the prompt) --

    public static JsonObject BuildBundle(string root, string itemId, JsonObject epic, string briefPath)
    {
        var stageNames = TasksStages(epic).Select(s => Json.Str(s["name"])!).ToList();
        return new JsonObject
        {
            ["epic"] = epic.DeepClone(),
            ["tasks_by_stage"] = new JsonArray(stageNames.Select(name => (JsonNode?)TasksStageFor(root, itemId, name)).ToArray()),
            ["write_path"] = briefPath.Replace('\\', '/'),
            ["has_spec"] = stageNames.Count > 0,
            ["component"] = epic["component"]?.DeepClone(),
        };
    }

    private static IEnumerable<JsonObject> TasksStages(JsonObject epic)
    {
        var candidates = new List<JsonObject> { epic };
        candidates.AddRange((epic["children"] as JsonArray ?? []).OfType<JsonObject>());
        foreach (var candidate in candidates)
            foreach (var stage in (candidate["stages"] as JsonArray ?? []).OfType<JsonObject>())
                if (Json.Str(stage["kind"]) == "tasks") yield return stage;
    }

    private static JsonObject TasksStageFor(string root, string itemId, string name)
    {
        var nodeId = SpeckitDeliverySource.StageNodeId(name, "tasks");
        var expanded = EpicsAssembler.For(root).Item(itemId, nodeId);
        if (expanded is null) return new JsonObject { ["stage_node_id"] = nodeId, ["name"] = null, ["sections"] = new JsonArray() };
        foreach (var stage in TasksStages(expanded))
            if (Json.Str(stage["name"]) == name)
                return new JsonObject { ["stage_node_id"] = nodeId, ["name"] = stage["name"]?.DeepClone(), ["sections"] = stage["sections"]?.DeepClone() ?? new JsonArray() };
        return new JsonObject { ["stage_node_id"] = nodeId, ["name"] = null, ["sections"] = new JsonArray() };
    }

    // -- normalization: EpicBrief.from_dict(...).to_dict() --

    private static JsonNode? Get(JsonObject data, string key, JsonNode? fallback) => data.ContainsKey(key) ? data[key]?.DeepClone() : fallback;

    private static JsonArray Dicts(JsonNode? entries, Func<JsonObject, JsonObject> build) =>
        new((entries as JsonArray ?? []).OfType<JsonObject>().Select(e => (JsonNode?)build(e)).ToArray());

    private static JsonObject BriefTask(JsonObject d) => new()
    {
        ["id"] = Get(d, "id", ""), ["text"] = Get(d, "text", ""), ["parallel"] = Json.Truthy(d["parallel"]),
        ["repo"] = Get(d, "repo", null), ["stage"] = Get(d, "stage", null), ["is_test"] = Json.Truthy(d["is_test"]),
    };

    private static JsonObject Scope(JsonObject d) => new()
    {
        ["id"] = Get(d, "id", ""), ["title"] = Get(d, "title", ""), ["description"] = Get(d, "description", ""),
        ["in_scope"] = d.ContainsKey("in_scope") ? Json.Truthy(d["in_scope"]) : true,
        ["tasks"] = Dicts(d["tasks"], BriefTask), ["tasks_source"] = Get(d, "tasks_source", null), ["out_of_scope_ref"] = Get(d, "out_of_scope_ref", null),
    };

    /// <summary>The brief as the canvas expects it: unknown keys dropped, missing ones defaulted, malformed entries skipped.</summary>
    public static JsonObject Normalize(JsonObject data) => new()
    {
        ["epic_id"] = Get(data, "epic_id", ""), ["generated_at"] = Get(data, "generated_at", ""),
        ["problem"] = data["problem"] is JsonArray p ? p.DeepClone() : new JsonArray(),
        ["component"] = Get(data, "component", null),
        ["spokes"] = Dicts(data["spokes"], d => new JsonObject { ["spoke"] = Get(d, "spoke", ""), ["role"] = Get(d, "role", "") }),
        ["scope"] = Dicts(data["scope"], Scope),
        ["prep_tasks"] = Dicts(data["prep_tasks"], BriefTask),
        ["dependencies"] = Dicts(data["dependencies"], d => new JsonObject
        {
            ["kind"] = Get(d, "kind", ""), ["text"] = Get(d, "text", ""), ["ids"] = d["ids"] is JsonArray ids ? ids.DeepClone() : new JsonArray(),
        }),
        ["acceptance"] = Dicts(data["acceptance"], d => new JsonObject
        {
            ["id"] = Get(d, "id", ""), ["text"] = Get(d, "text", ""), ["done"] = Get(d, "done", null), ["closes_scope_id"] = Get(d, "closes_scope_id", null),
        }),
    };

    // -- resolver: refresh every task's text/parallel from tasks.md by (stage, id) --

    private sealed record RealTask(string Text, bool Parallel);

    private static Dictionary<(string?, string), RealTask?> TaskIndex(string root, JsonObject epic)
    {
        var bundle = BuildBundle(root, Json.Str(epic["id"])!, epic, "");
        var index = new Dictionary<(string?, string), RealTask?>();
        foreach (var stage in (bundle["tasks_by_stage"] as JsonArray ?? []).OfType<JsonObject>())
            foreach (var section in (stage["sections"] as JsonArray ?? []).OfType<JsonObject>())
                foreach (var item in (section["items"] as JsonArray ?? []).OfType<JsonObject>())
                {
                    if (Json.Str(item["id"]) is not { } id) continue;
                    var key = (Json.Str(stage["name"]), id);
                    index[key] = index.ContainsKey(key) ? null : new RealTask(Json.Str(item["text"]) ?? "", Json.Truthy(item["parallel"]));
                }
        return index;
    }

    private static JsonNode? MergeTask(JsonNode? task, Dictionary<(string?, string), RealTask?> index)
    {
        if (task is not JsonObject t) return task;
        if (Json.Str(t["id"]) is not { } id || !index.TryGetValue((Json.Str(t["stage"]), id), out var real) || real is null) return task;
        var merged = (JsonObject)t.DeepClone();
        merged["text"] = real.Text;
        merged["parallel"] = real.Parallel;
        return merged;
    }

    /// <summary>The brief from disk with every task's text and parallel flag refreshed from tasks.md.</summary>
    public static JsonObject Resolve(JsonObject raw, string root, JsonObject epic)
    {
        var index = TaskIndex(root, epic);
        var merged = (JsonObject)raw.DeepClone();
        if (raw["scope"] is JsonArray scope)
            merged["scope"] = new JsonArray(scope.Select(item =>
            {
                if (item is not JsonObject o || o["tasks"] is not JsonArray tasks) return item?.DeepClone();
                var copy = (JsonObject)o.DeepClone();
                copy["tasks"] = new JsonArray(tasks.Select(t => MergeTask(t, index)?.DeepClone()).ToArray());
                return copy;
            }).ToArray());
        if (raw["prep_tasks"] is JsonArray prep) merged["prep_tasks"] = new JsonArray(prep.Select(t => MergeTask(t, index)?.DeepClone()).ToArray());
        return merged;
    }
}
