using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Skills;

/// <summary>One runner per skill-run kind, built once per bridge so two hosts never share job state.</summary>
public sealed class SkillAgents
{
    private readonly Dictionary<string, SkillAgent> _agents = [];

    public SkillAgents(CliResolver resolver, RuntimeEnvironment runtime, SkillRunSettings? settings = null)
    {
        foreach (var spec in Specs()) _agents[spec.Kind] = new SkillAgent(spec.Spec, resolver, runtime, settings);
    }

    public SkillAgent this[string kind] => _agents[kind];

    public bool Has(string kind) => _agents.ContainsKey(kind);

    public IEnumerable<SkillAgent> All => _agents.Values;

    public sealed record KindSpec(string Kind, SkillAgentSpec Spec);

    /// <summary>The diagram and review kinds; the composite kinds are added by their own modules.</summary>
    private static IEnumerable<KindSpec> Specs()
    {
        foreach (var kind in new[] { "c1", "patterns", "impact", "epics", "sequence" })
            yield return new KindSpec(kind, new SkillAgentSpec(
                $"{kind}_agent", Prompts.Render($"{kind}_agent"), SkillTimeouts.Model,
                (root, _) => Workspace.DiagramPath(root, kind),
                HasValidFlatDiagram, $"codechroma_{kind.ToUpperInvariant()}_TIMEOUT_SECONDS", SkillTimeouts.For(kind),
                $"generation produced no valid {kind}.json"));
        yield return new KindSpec(ProcessDiagram.Kind, new SkillAgentSpec(
            "c1_agent", null, SkillTimeouts.Model, (root, key) => Workspace.DiagramPath(root, "custom/" + SkillAgent.ItemFromKey(key)),
            HasValidFlatDiagram, "codechroma_PROCESS_DIAGRAM_TIMEOUT_SECONDS", SkillTimeouts.For("custom"), "generation produced no valid diagram"));
        yield return new KindSpec("impact-changes", new SkillAgentSpec(
            "impact-changes_review_agent", Prompts.Render("impact_review_agent"), SkillTimeouts.Model,
            (root, _) => ImpactChangesPath(root), data => data is JsonObject, "codechroma_IMPACT_REVIEW_TIMEOUT_SECONDS",
            SkillTimeouts.For("impact-changes"), "review produced no valid impact-changes.json"));
        yield return new KindSpec("workflow-step", WorkflowSpec("workflow_step_agent", "STEP", "workflow-step"));
        yield return new KindSpec("workflow-chat", WorkflowSpec("workflow_chat_agent", "CHAT", "workflow-chat") with
        {
            Artifact = (_, key) => Workflows.WorkflowRunner.Marker("chat", key),
            Validate = data => data is JsonObject,
            InvalidError = "workflow chat left no marker",
        });
        yield return new KindSpec("epic-brief", Epics.EpicBrief.Spec());
        foreach (var wiki in WikiGeneral.Specs()) yield return wiki;
    }

    private static SkillAgentSpec WorkflowSpec(string name, string envPart, string kind) =>
        SkillAgentSpec.NoArtifact(name, null, SkillTimeouts.Model, $"codechroma_WORKFLOW_{envPart}_TIMEOUT_SECONDS", SkillTimeouts.For(kind));

    public static string ImpactChangesPath(string repoRoot) => Path.Combine(repoRoot, ".codechroma", "impact-changes.json");

    /// <summary>A flat nodes[] diagram, not still the unreviewed bootstrap draft, with no unusable nodes.</summary>
    public static bool HasValidFlatDiagram(JsonNode? data) => data is JsonObject o && !Json.Truthy(o["draft"]) && EntriesAreUsable(data, "nodes");

    /// <summary>True unless the key is a non-empty list in which no entry is an object with a string id (empty clears a diagram).</summary>
    public static bool EntriesAreUsable(JsonNode? data, string key)
    {
        if (data is not JsonObject o) return false;
        if (o[key] is not JsonArray { Count: > 0 } entries) return true;
        return entries.Any(item => item is JsonObject i && Json.IsString(i["id"]));
    }
}
