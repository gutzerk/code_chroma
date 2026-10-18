using System.Text.Json.Nodes;

namespace CodeChroma.Core.Patterns;

/// <summary>The read-only structural payload the patterns skill reads (classes + seed candidates); mirrors bridge/patterns_context.py.</summary>
public static class PatternsContext
{
    private static JsonArray Strings(IEnumerable<string> values) => new(values.Select(v => (JsonNode?)JsonValue.Create(v)).ToArray());

    private static JsonObject MethodEntry(string name, MethodShape shape) => new()
    {
        ["name"] = name,
        ["decorators"] = Strings(shape.Decorators),
        ["reads_dict_attrs"] = Strings(shape.ReadsDictAttrs),
        ["writes_dict_attrs"] = Strings(shape.WritesDictAttrs),
        ["appends_list_attrs"] = Strings(shape.AppendsListAttrs),
        ["iterates_attrs"] = Strings(shape.IteratesAttrs),
        ["sets_class_attr"] = Strings(shape.SetsClassAttr),
        ["checks_none_class_attr"] = Strings(shape.ChecksNoneClassAttr),
        ["calls_on_attr"] = new JsonObject(shape.CallsOnAttr.Select(p => KeyValuePair.Create(p.Key, (JsonNode?)Strings(p.Value)))),
    };

    private static JsonObject? ClassEntry(DependencyIndex index, Graph graph, string symbolId, ClassShape shape)
    {
        if (!graph.Symbols.TryGetValue(symbolId, out var symbol)) return null;
        var nodeId = graph.Nodes.ContainsKey(symbolId) ? symbolId : null;
        return new JsonObject
        {
            ["id"] = symbolId,
            ["name"] = symbol.Name,
            ["qualified_name"] = symbol.QualifiedName,
            ["path"] = symbol.FilePath,
            ["node_id"] = nodeId,
            ["bases"] = Strings(shape.Bases),
            ["decorators"] = Strings(shape.Decorators),
            ["is_abstract"] = shape.IsAbstract,
            ["class_attrs"] = new JsonObject(shape.ClassAttrs.Select(p => KeyValuePair.Create(p.Key, (JsonNode?)JsonValue.Create(p.Value)))),
            ["methods"] = new JsonArray(shape.Methods.OrderBy(p => p.Key, StringComparer.Ordinal).Select(p => (JsonNode?)MethodEntry(p.Key, p.Value)).ToArray()),
            ["calls"] = nodeId is null ? new JsonArray() : Strings(index.DependenciesOf(nodeId)),
            ["called_by"] = nodeId is null ? new JsonArray() : Strings(index.DependentsOf(nodeId)),
        };
    }

    public static JsonObject Build(Graph graph, IReadOnlyDictionary<string, ClassShape> shapes, IEnumerable<PatternInstance> candidates)
    {
        var index = new DependencyIndex(graph);
        var classes = shapes.OrderBy(p => p.Key, StringComparer.Ordinal)
            .Select(p => ClassEntry(index, graph, p.Key, p.Value)).OfType<JsonObject>().Select(e => (JsonNode?)e).ToArray();
        return new JsonObject
        {
            ["classes"] = new JsonArray(classes),
            ["heuristic_candidates"] = new JsonArray(candidates.Select(c => (JsonNode?)PatternSerialize.SerializeInstance(c)).ToArray()),
        };
    }
}
