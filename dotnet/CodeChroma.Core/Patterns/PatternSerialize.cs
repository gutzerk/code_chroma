using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace CodeChroma.Core.Patterns;

/// <summary>Serializing pattern instances and fingerprinting the candidate set; mirrors patterns/serialize.py.</summary>
public static class PatternSerialize
{
    public const string InstanceKind = "pattern-instance";

    /// <summary>sha1 hex of the ordinally-sorted lines joined by newlines (fingerprint.hash_lines).</summary>
    public static string HashLines(IEnumerable<string> lines)
    {
        var sorted = lines.ToList();
        sorted.Sort(StringComparer.Ordinal);
        return Convert.ToHexString(SHA1.HashData(Encoding.UTF8.GetBytes(string.Join('\n', sorted)))).ToLowerInvariant();
    }

    public static string Wire(PatternType type) => type.ToString().ToLowerInvariant();

    public static string Wire(PatternRole role) => role.ToString().ToLowerInvariant();

    public static string Wire(PatternRelationKind kind) => kind.ToString().ToLowerInvariant();

    /// <summary>Stable hash of the candidate set's structure, not its confirmed prose.</summary>
    public static string FingerprintFor(IEnumerable<PatternInstance> candidates) =>
        HashLines(candidates.Select(c =>
            $"{Wire(c.Type)} {c.Id} " + string.Join(',', c.Participants.Select(p => p.Id).OrderBy(i => i, StringComparer.Ordinal))));

    private static JsonObject SerializeParticipant(PatternParticipant p) => new()
    {
        ["id"] = p.Id,
        ["role"] = Wire(p.Role),
        ["name"] = p.Name,
        ["qualified_name"] = p.QualifiedName,
        ["node_id"] = p.NodeId,
        ["path"] = p.Path,
        ["description"] = p.Description,
    };

    private static JsonObject SerializeRelation(PatternRelation r) => new()
    {
        ["from"] = r.FromId,
        ["to"] = r.ToId,
        ["kind"] = Wire(r.Kind),
        ["label"] = r.Label,
    };

    public static JsonObject SerializeInstance(PatternInstance i) => new()
    {
        ["id"] = i.Id,
        ["type"] = Wire(i.Type),
        ["name"] = i.Name,
        ["description"] = i.Description,
        ["confirmed"] = i.Confirmed,
        ["confidence"] = i.Confidence,
        ["participants"] = new JsonArray(i.Participants.Select(p => (JsonNode)SerializeParticipant(p)).ToArray()),
        ["relations"] = new JsonArray(i.Relations.Select(r => (JsonNode)SerializeRelation(r)).ToArray()),
    };

    /// <summary>One instance as a shared flat-diagram node.</summary>
    public static JsonObject InstanceNode(JsonObject serialized) => new()
    {
        ["id"] = serialized["id"]!.DeepClone(),
        ["name"] = serialized["name"]!.DeepClone(),
        ["description"] = serialized["description"]?.GetValue<string>() ?? "",
        ["kind"] = InstanceKind,
        ["meta"] = new JsonObject
        {
            ["type"] = serialized["type"]!.DeepClone(),
            ["confirmed"] = serialized["confirmed"]?.DeepClone(),
            ["confidence"] = serialized["confidence"]?.DeepClone(),
        },
    };

    /// <summary>One participant as a shared flat-diagram node, nested under its instance.</summary>
    public static JsonObject ParticipantNode(JsonObject participant, string instanceId) => new()
    {
        ["id"] = participant["id"]!.DeepClone(),
        ["parent"] = instanceId,
        ["name"] = participant["name"]!.DeepClone(),
        ["description"] = participant["description"]?.GetValue<string>() ?? "",
        ["node_id"] = participant["node_id"]?.DeepClone(),
        ["path"] = participant["path"]?.DeepClone(),
        ["meta"] = new JsonObject { ["role"] = participant["role"]!.DeepClone() },
    };
}
