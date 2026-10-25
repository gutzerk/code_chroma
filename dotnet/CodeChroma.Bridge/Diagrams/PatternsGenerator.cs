using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Skills;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;
using CodeChroma.Core.Patterns;

namespace CodeChroma.Bridge.Diagrams;

/// <summary>One-shot AI confirmation pass over the free heuristic pattern candidates; mirrors context/patterns_generator.py.</summary>
public static class PatternsGenerator
{
    public const string CallSiteId = "initial_diagram_bootstrap";

    /// <summary>One completion call confirming or rejecting each heuristic candidate, or null on no candidates, no provider or any failure.</summary>
    public static async Task<JsonObject?> Generate(IReadOnlyList<PatternInstance> candidates, ILlmCompletion? provider, string model)
    {
        if (candidates.Count == 0 || provider is null) return null;
        var serialized = candidates.Select(PatternSerialize.SerializeInstance).ToList();
        var listing = new JsonArray(serialized.Select(s => (JsonNode?)s.DeepClone()).ToArray());
        var prompt = Prompts.Render("patterns_generator", "user",
            ("candidates_json", listing.ToJsonString(new JsonSerializerOptions { WriteIndented = true })));
        try
        {
            var text = await provider.Complete(prompt, model, BridgeLimits.PatternsGeneratorMaxTokens, Prompts.Render("patterns_generator", "system"));
            return Build(candidates, JsonNode.Parse(text));
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            return null;
        }
    }

    /// <summary>Merges each confirmation onto its candidate's own shape, flattened to nodes and relations; null when nothing matches.</summary>
    public static JsonObject? Build(IReadOnlyList<PatternInstance> candidates, JsonNode? data)
    {
        if (data is not JsonObject || data["confirmations"] is not JsonArray confirmations) return null;
        var byId = new Dictionary<string, JsonObject>(StringComparer.Ordinal);
        foreach (var item in confirmations)
            if (item is JsonObject o && Json.Str(o["id"]) is { } id) byId[id] = o;
        var nodes = new JsonArray();
        var relations = new JsonArray();
        var matched = false;
        foreach (var instance in candidates.Select(PatternSerialize.SerializeInstance))
        {
            if (!byId.TryGetValue(instance["id"]!.GetValue<string>(), out var confirmation)) continue;
            var merged = Merge(instance, confirmation);
            matched = true;
            nodes.Add(PatternSerialize.InstanceNode(merged));
            foreach (var participant in merged["participants"]!.AsArray())
                nodes.Add(PatternSerialize.ParticipantNode(participant!.AsObject(), merged["id"]!.GetValue<string>()));
            foreach (var relation in merged["relations"]!.AsArray()) relations.Add(relation!.DeepClone());
        }
        if (!matched) return null;
        return new JsonObject
        {
            ["type"] = "patterns",
            ["generated_at"] = DateTimeOffset.UtcNow.ToString("o"),
            ["nodes"] = nodes,
            ["relations"] = relations,
            ["fingerprint"] = PatternSerialize.FingerprintFor(candidates),
        };
    }

    /// <summary>Only confirmed, name and description come from the model; participants stay real.</summary>
    private static JsonObject Merge(JsonObject instance, JsonObject confirmation)
    {
        var merged = (JsonObject)instance.DeepClone();
        merged["confirmed"] = Json.Truthy(confirmation["confirmed"]);
        if (Json.Str(confirmation["name"]) is { Length: > 0 } name) merged["name"] = name;
        if (Json.Str(confirmation["description"]) is { Length: > 0 } description) merged["description"] = description;
        return merged;
    }
}
