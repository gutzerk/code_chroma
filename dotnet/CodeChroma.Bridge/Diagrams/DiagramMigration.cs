using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Diagrams;

/// <summary>Flat-id allocation for c1: fresh ids for repeated bare names, plus endpoint resolution.</summary>
public sealed class IdAddressBook
{
    private readonly HashSet<string> _used = [];
    private readonly Dictionary<string, string> _addressToId = [];
    private readonly Dictionary<string, int> _bareSeen = [];

    public string Fresh(string candidate)
    {
        if (_used.Add(candidate)) return candidate;
        var suffix = 2;
        while (_used.Contains($"{candidate}-{suffix}")) suffix++;
        var unique = $"{candidate}-{suffix}";
        _used.Add(unique);
        return unique;
    }

    public void Address(string trail, string bare, string newId)
    {
        _addressToId[trail] = newId;
        _bareSeen[bare] = _bareSeen.GetValueOrDefault(bare) + 1;
        if (_bareSeen[bare] == 1) _addressToId[bare] = newId;
        else _addressToId.Remove(bare);
    }

    public string? Resolve(string reference) => _addressToId.GetValueOrDefault(reference);
}

/// <summary>Converts a pre-036 saved c1 file (nested system/actors tree) to the shared flat nodes/relations shape.</summary>
public static class DiagramMigration
{
    private const int MaxDepth = 5;

    public enum Status { Unchanged, Converted, NeedsRegeneration }

    public static (JsonObject Data, Status Status) Migrate(string kind, JsonObject data)
    {
        if (kind != "system-context" || data.Count == 0 || data["nodes"] is JsonArray || !(data["system"] is JsonObject || data["actors"] is JsonArray)) return (data, Status.Unchanged);
        try
        {
            return ConvertC1(data) is { } converted ? (converted, Status.Converted) : (data, Status.NeedsRegeneration);
        }
        catch (Exception)
        {
            return (data, Status.NeedsRegeneration);
        }
    }

    private static void CopyOptional(JsonObject from, JsonObject to, params string[] keys)
    {
        foreach (var key in keys)
            if (Json.Truthy(from[key])) to[key] = from[key]!.DeepClone();
    }

    private static JsonObject? ConvertC1(JsonObject data)
    {
        if (data["system"] is not JsonObject system) return null;
        var ids = new IdAddressBook();
        var nodes = new JsonArray();

        void Walk(JsonNode? children, string parentId, string parentTrail, int depth)
        {
            if (children is not JsonArray list || depth > MaxDepth) return;
            foreach (var child in list.OfType<JsonObject>())
            {
                if (Json.Str(child["id"]) is not { Length: > 0 } bare) continue;
                var trail = $"{parentTrail}/{bare}";
                var newId = ids.Fresh(bare);
                ids.Address(trail, bare, newId);
                var node = new JsonObject { ["id"] = newId, ["name"] = Name(child, bare), ["parent"] = parentId };
                CopyOptional(child, node, "description", "path", "kind", "icon", "style");
                nodes.Add(node);
                Walk(child["children"], newId, trail, depth + 1);
            }
        }

        var systemId = ids.Fresh("system");
        ids.Address("system", "system", systemId);
        nodes.Add(new JsonObject
        {
            ["id"] = systemId, ["name"] = Name(system, "System"), ["description"] = system["description"]?.DeepClone() ?? "", ["kind"] = "system",
        });
        Walk(system["children"], systemId, "system", 1);

        foreach (var actor in (data["actors"] as JsonArray ?? []).OfType<JsonObject>())
        {
            if (Json.Str(actor["id"]) is not { Length: > 0 } bare) continue;
            var newId = ids.Fresh(bare);
            ids.Address(bare, bare, newId);
            var node = new JsonObject { ["id"] = newId, ["name"] = Name(actor, bare), ["kind"] = Json.Truthy(actor["type"]) ? actor["type"]!.DeepClone() : "external_system" };
            CopyOptional(actor, node, "description", "icon");
            nodes.Add(node);
            Walk(actor["children"], newId, bare, 1);
        }

        var relations = new JsonArray();
        foreach (var rel in (data["relationships"] as JsonArray ?? []).OfType<JsonObject>())
        {
            var source = Json.Str(rel["from"]) is { } f ? ids.Resolve(f) : null;
            var target = Json.Str(rel["to"]) is { } t ? ids.Resolve(t) : null;
            if (source is null || target is null) continue;
            var relation = new JsonObject { ["from"] = source, ["to"] = target, ["label"] = rel["label"]?.DeepClone() ?? "" };
            CopyOptional(rel, relation, "technology");
            relations.Add(relation);
        }
        return new JsonObject { ["type"] = "system-context", ["style"] = "boxes-arrows", ["nodes"] = nodes, ["relations"] = relations };
    }

    private static string Name(JsonObject source, string fallback) => Json.Truthy(source["name"]) ? source["name"]!.ToString() : fallback;
}

/// <summary>Reading a workspace's authored diagram with the legacy conversion applied on first access.</summary>
public static class DiagramArtifacts
{
    /// <summary>The diagram's JSON (c1 from the borrowed root of a PR workspace); {} when missing; a legacy c1 converts in place, an unconvertible one is flagged.</summary>
    public static JsonObject Load(Workspace ws, string kind)
    {
        var path = Workspace.DiagramPath(kind == "system-context" ? ws.C1Root : ws.Root, kind);
        var data = JsonFile.Load(path) as JsonObject ?? new JsonObject();
        var (migrated, status) = DiagramMigration.Migrate(kind, data);
        switch (status)
        {
            case DiagramMigration.Status.Converted:
                JsonFile.Write(path, migrated);
                return migrated;
            case DiagramMigration.Status.NeedsRegeneration:
                var flagged = (JsonObject)data.DeepClone();
                flagged["needs_regeneration"] = true;
                return flagged;
            default:
                return migrated;
        }
    }

    /// <summary>A stable fingerprint of the repo's dependency digest, the staleness signal of a custom diagram.</summary>
    public static string DigestFingerprint(Workspace ws)
    {
        var digest = JsonFile.Load(Path.Combine(ws.Root, ".codechroma", "dependency-digest.json")) ?? new JsonObject();
        return CodeChroma.Core.Patterns.PatternSerialize.HashLines([PythonDumps(digest as JsonObject ?? new JsonObject())]);
    }

    /// <summary>Python's `json.dumps(node, sort_keys=True)`: ", " and ": " separators and ASCII-only escapes, so both bridges hash the same text.</summary>
    public static string PythonDumps(JsonNode? node)
    {
        var text = new System.Text.StringBuilder();
        Dump(node, text);
        return text.ToString();
    }

    private static void Dump(JsonNode? node, System.Text.StringBuilder text)
    {
        switch (node)
        {
            case null:
                text.Append("null");
                break;
            case JsonObject o:
                text.Append('{');
                var first = true;
                foreach (var (key, value) in o.OrderBy(kv => kv.Key, StringComparer.Ordinal))
                {
                    if (!first) text.Append(", ");
                    first = false;
                    DumpString(key, text);
                    text.Append(": ");
                    Dump(value, text);
                }
                text.Append('}');
                break;
            case JsonArray a:
                text.Append('[');
                for (var i = 0; i < a.Count; i++)
                {
                    if (i > 0) text.Append(", ");
                    Dump(a[i], text);
                }
                text.Append(']');
                break;
            case JsonValue v when v.TryGetValue<string>(out var str):
                DumpString(str, text);
                break;
            case JsonValue v when v.TryGetValue<bool>(out var flag):
                text.Append(flag ? "true" : "false");
                break;
            default:
                text.Append(node.ToJsonString());
                break;
        }
    }

    private static void DumpString(string value, System.Text.StringBuilder text)
    {
        text.Append('"');
        foreach (var c in value)
        {
            switch (c)
            {
                case '"': text.Append("\\\""); break;
                case '\\': text.Append("\\\\"); break;
                case '\n': text.Append("\\n"); break;
                case '\r': text.Append("\\r"); break;
                case '\t': text.Append("\\t"); break;
                case '\b': text.Append("\\b"); break;
                case '\f': text.Append("\\f"); break;
                case < ' ' or > (char)127: text.Append("\\u").Append(((int)c).ToString("x4")); break;
                default: text.Append(c); break;
            }
        }
        text.Append('"');
    }
}
