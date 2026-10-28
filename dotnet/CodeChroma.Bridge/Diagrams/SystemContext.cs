using System.Text.Json.Nodes;
using CodeChroma.Bridge.Engine;
using CodeChroma.Bridge.Stores;
using CodeChroma.Core.Patterns;

namespace CodeChroma.Bridge.Diagrams;

/// <summary>The system-context diagram's free candidate layer (people and external systems seen in the code), merged with the authored c1.json the way PatternsResolver merges patterns.</summary>
public static class SystemContext
{
    public const string SystemId = "system";
    private const string PersonKind = "person";
    private const string ExternalKind = "external_system";

    /// <summary>One person or external system the code gives evidence for.</summary>
    public sealed record Candidate(string Id, string Kind, string Name, string? Icon, string Evidence);

    /// <summary>Frameworks that say who uses the system: a web UI has users, a CLI framework has developers.</summary>
    private static readonly IReadOnlyDictionary<string, (string Name, string Description)> KnownActors = new Dictionary<string, (string, string)>
    {
        ["flask"] = ("User", "Uses the system through its web interface or HTTP API."),
        ["fastapi"] = ("User", "Uses the system through its web interface or HTTP API."),
        ["django"] = ("User", "Uses the system through its web interface or HTTP API."),
        ["express"] = ("User", "Uses the system through its web interface or HTTP API."),
        ["react"] = ("User", "Uses the system through its web interface or HTTP API."),
        ["vue"] = ("User", "Uses the system through its web interface or HTTP API."),
        ["click"] = ("Developer", "Runs the system from the command line."),
        ["typer"] = ("Developer", "Runs the system from the command line."),
        ["commander"] = ("Developer", "Runs the system from the command line."),
        ["yargs"] = ("Developer", "Runs the system from the command line."),
        ["cobra"] = ("Developer", "Runs the system from the command line."),
    };

    /// <summary>Candidates in a stable order: external systems first (one per product), then people; an unmatched dependency is omitted, never guessed.</summary>
    public static List<Candidate> Detect(JsonObject digest)
    {
        var result = new List<Candidate>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var dependency in Dependencies(digest).Select(NormalizeName).Distinct())
        {
            if (!C1Template.KnownExternalSystems.TryGetValue(dependency, out var known) || !seen.Add(known.Name)) continue;
            result.Add(new Candidate(dependency, ExternalKind, known.Name, known.Icon, $"Detected via the '{dependency}' dependency."));
        }
        foreach (var dependency in Dependencies(digest).Select(NormalizeName).Distinct())
        {
            if (!KnownActors.TryGetValue(dependency, out var actor) || !seen.Add(actor.Name)) continue;
            result.Add(new Candidate(actor.Name.ToLowerInvariant(), PersonKind, actor.Name, null, actor.Description));
        }
        return result;
    }

    /// <summary>Stable hash of what was detected, not of the prose written about it.</summary>
    public static string Fingerprint(IEnumerable<Candidate> candidates) =>
        PatternSerialize.HashLines(candidates.Select(c => $"{c.Kind} {c.Id}"));

    /// <summary>The generation_data the context route hands the drawing skill.</summary>
    public static JsonObject Context(JsonObject digest, IEnumerable<Candidate> candidates) => new()
    {
        ["repo_name"] = digest["repo_name"]?.DeepClone(),
        ["readme_excerpt"] = digest["readme_excerpt"]?.DeepClone(),
        ["candidates"] = new JsonArray(candidates.Select(c => (JsonNode?)new JsonObject
        {
            ["id"] = c.Id,
            ["kind"] = c.Kind,
            ["name"] = c.Name,
            ["evidence"] = c.Evidence,
        }).ToArray()),
    };

    private static JsonObject CandidateNode(Candidate c)
    {
        var node = new JsonObject
        {
            ["id"] = c.Id,
            ["kind"] = c.Kind,
            ["name"] = c.Name,
            ["description"] = c.Evidence,
            ["meta"] = new JsonObject { ["detected"] = true },
        };
        if (!string.IsNullOrEmpty(c.Icon)) node["icon"] = c.Icon;
        return node;
    }

    private static JsonObject CandidateRelation(Candidate c) => c.Kind == PersonKind
        ? new JsonObject { ["from"] = c.Id, ["to"] = SystemId, ["label"] = "Uses" }
        : new JsonObject { ["from"] = SystemId, ["to"] = c.Id, ["label"] = "Uses" };

    /// <summary>A detected node with the authored prose and review verdict laid over it.</summary>
    private static JsonObject Overlay(JsonObject detected, JsonObject authored)
    {
        var merged = (JsonObject)detected.DeepClone();
        foreach (var field in new[] { "name", "description", "icon" })
            if (Json.Truthy(authored[field])) merged[field] = authored[field]!.DeepClone();
        var meta = (JsonObject)merged["meta"]!;
        if (authored["meta"] is JsonObject authoredMeta && authoredMeta.ContainsKey("confirmed"))
            meta["confirmed"] = authoredMeta["confirmed"]?.DeepClone();
        return merged;
    }

    private static bool IsRejected(JsonObject node) =>
        node["meta"] is JsonObject meta && meta["confirmed"] is JsonValue v && v.TryGetValue(out bool confirmed) && !confirmed;

    public static JsonObject Resolve(IGraphEngine engine, JsonObject digest, JsonObject authored)
    {
        var candidates = Detect(digest);
        var persisted = (authored["nodes"] as JsonArray ?? []).OfType<JsonObject>().Where(n => Json.Str(n["id"]) is not null).ToList();
        var persistedById = persisted.GroupBy(n => Json.Str(n["id"])!).ToDictionary(g => g.Key, g => g.First());

        var nodes = new List<JsonObject>();
        var relations = new List<JsonObject>();
        if (persistedById.TryGetValue(SystemId, out var system)) nodes.Add((JsonObject)system.DeepClone());
        else if (authored.Count > 0 || candidates.Count > 0)
            nodes.Add(new JsonObject { ["id"] = SystemId, ["kind"] = "system", ["name"] = Json.Str(digest["repo_name"]) ?? SystemId });

        var authoredRelations = (authored["relations"] as JsonArray ?? []).OfType<JsonObject>().ToList();
        var matched = new HashSet<string> { SystemId };
        foreach (var candidate in candidates)
        {
            var node = CandidateNode(candidate);
            if (persistedById.TryGetValue(candidate.Id, out var entry))
            {
                matched.Add(candidate.Id);
                node = Overlay(node, entry);
            }
            if (IsRejected(node)) continue;
            nodes.Add(node);
            var touched = authoredRelations.Any(r => Json.Str(r["from"]) == candidate.Id || Json.Str(r["to"]) == candidate.Id);
            if (!touched) relations.Add(CandidateRelation(candidate));
        }
        nodes.AddRange(persisted.Where(n => !matched.Contains(Json.Str(n["id"])!)).Select(n => (JsonObject)n.DeepClone()));

        var surviving = nodes.Select(n => Json.Str(n["id"])!).ToHashSet();
        relations.AddRange(authoredRelations);
        var data = (JsonObject)authored.DeepClone();
        data["type"] = "system-context";
        data["nodes"] = new JsonArray(nodes.Select(n => (JsonNode?)n).ToArray());
        data["relations"] = new JsonArray(relations
            .Where(r => Json.Str(r["from"]) is { } from && Json.Str(r["to"]) is { } to && surviving.Contains(from) && surviving.Contains(to))
            .Select(r => (JsonNode?)r.DeepClone()).ToArray());
        var resolved = DiagramResolver.Resolve(engine, data);
        resolved["has_diagram"] = authored.Count > 0;
        return DiagramResolver.AttachStaleness(DiagramResolver.AttachCoverage(resolved, engine), Fingerprint(candidates), Json.Str(authored["fingerprint"]));
    }

    /// <summary>Lower-cases a dependency and drops any extras, version specifier or marker (`psycopg2>=2.9`, `boto3[crypto]`).</summary>
    private static string NormalizeName(string name)
    {
        var end = name.IndexOfAny(['[', '<', '>', '=', '!', '~', ';', '(', ' ']);
        return (end < 0 ? name : name[..end]).ToLowerInvariant();
    }

    private static IEnumerable<string> Dependencies(JsonObject digest)
    {
        if (digest["declared_dependencies"] is JsonArray declared)
            foreach (var item in declared)
                if (Json.Str(item) is { } text) yield return text;
        if (digest["external_import_roots"] is JsonArray roots)
            foreach (var entry in roots)
                if (entry is JsonObject o && Json.Str(o["root"]) is { } root) yield return root;
    }
}
