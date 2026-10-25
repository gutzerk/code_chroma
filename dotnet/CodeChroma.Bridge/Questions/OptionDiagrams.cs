using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Questions;

public sealed record DiagramNode(string Id, string Label, string Description = "", string? Status = null);

public sealed record DiagramEdge(string From, string To, string Label = "");

/// <summary>Small per-option decision diagrams: the budget check and the canvas ops that draw one (questions/diagrams.py).</summary>
public static class OptionDiagrams
{
    public const string Layer = "decisions";
    public const int MaxNodes = 12;
    public const int MaxId = 40;
    public const int MaxTitle = 80;
    public const int MaxLabel = 60;
    public const int MaxDescription = 300;
    public const int BandHeight = 3 * CellH + 80;

    private const int Columns = 4;
    private const int CellW = 200, CellH = 100;
    private const int NodeW = 160, NodeH = 60;

    public static List<DiagramNode> ParseNodes(JsonNode? node)
    {
        if (node is not JsonArray array) throw new QuestionRejected("nodes must be an array");
        return array.Select((n, i) =>
        {
            if (n is not JsonObject o || Json.Str(o["id"]) is not { } id || Json.Str(o["label"]) is not { } label)
                throw new QuestionRejected($"nodes[{i}]: id and label are required strings");
            return new DiagramNode(id, label, Json.Str(o["description"]) ?? "", Json.Str(o["status"]));
        }).ToList();
    }

    public static List<DiagramEdge> ParseEdges(JsonNode? node)
    {
        if (node is null) return [];
        if (node is not JsonArray array) throw new QuestionRejected("edges must be an array");
        return array.Select((n, i) =>
        {
            if (n is not JsonObject o || Json.Str(o["from"]) is not { } from || Json.Str(o["to"]) is not { } to)
                throw new QuestionRejected($"edges[{i}]: from and to are required strings");
            return new DiagramEdge(from, to, Json.Str(o["label"]) ?? "");
        }).ToList();
    }

    /// <summary>One line per budget, length or reference problem; mirrors the skill's check script.</summary>
    public static List<string> Validate(IReadOnlyList<DiagramNode> nodes, IReadOnlyList<DiagramEdge> edges, string title)
    {
        var found = new List<string>();
        if (string.IsNullOrWhiteSpace(title)) found.Add("title is empty");
        else if (title.Length > MaxTitle) found.Add($"title is longer than {MaxTitle} characters");
        if (nodes.Count < 1 || nodes.Count > MaxNodes) found.Add($"give 1-{MaxNodes} nodes, got {nodes.Count}");
        var ids = nodes.Select(n => n.Id).ToList();
        if (ids.Distinct().Count() != ids.Count) found.Add("node ids are not unique");
        foreach (var n in nodes)
        {
            if (string.IsNullOrWhiteSpace(n.Id)) found.Add("node with empty id");
            else if (n.Id.Length > MaxId) found.Add($"node \"{n.Id}\": id is longer than {MaxId} characters");
            if (string.IsNullOrWhiteSpace(n.Label)) found.Add($"node \"{n.Id}\": empty label");
            else if (n.Label.Length > MaxLabel) found.Add($"node \"{n.Id}\": label is longer than {MaxLabel} characters");
            if (n.Description.Length > MaxDescription) found.Add($"node \"{n.Id}\": description is longer than {MaxDescription} characters");
        }
        var seen = new HashSet<(string, string)>();
        foreach (var e in edges)
        {
            if (!ids.Contains(e.From) || !ids.Contains(e.To)) found.Add($"edge {e.From}->{e.To}: unknown node");
            else if (e.From == e.To) found.Add($"edge {e.From}->{e.To}: self-loop");
            else if (seen.Contains((e.From, e.To))) found.Add($"edge {e.From}->{e.To}: duplicate");
            seen.Add((e.From, e.To));
        }
        return found;
    }

    /// <summary>Raises QuestionRejected with every problem, in the tool-error shape.</summary>
    public static void Check(IReadOnlyList<DiagramNode> nodes, IReadOnlyList<DiagramEdge> edges, string title)
    {
        var problems = Validate(nodes, edges, title);
        if (problems.Count > 0) throw new QuestionRejected(QuestionValidation.RejectionText(problems, "diagram"));
    }

    /// <summary>The apply_batch ops for one diagram: a group root, its nodes in a grid, then the arrows.</summary>
    public static List<JsonNode?> Ops(string title, IReadOnlyList<DiagramNode> nodes, IReadOnlyList<DiagramEdge> edges, int band, string? optionId)
    {
        var top = band * BandHeight;
        var ops = new List<JsonNode?>
        {
            new JsonObject
            {
                ["op"] = "add_group", ["temp_id"] = "root", ["layer"] = Layer, ["label"] = title,
                ["position"] = new JsonObject { ["x"] = 0.0, ["y"] = (double)top },
                ["size"] = new JsonObject { ["w"] = (double)(Columns * CellW + 40), ["h"] = (double)((int)Math.Ceiling(nodes.Count / (double)Columns) * CellH + 40) },
                ["meta"] = new JsonObject { ["diagram_root"] = true, ["option_id"] = optionId },
            },
        };
        for (var index = 0; index < nodes.Count; index++)
        {
            var node = nodes[index];
            ops.Add(new JsonObject
            {
                ["op"] = "add_element", ["temp_id"] = "n:" + node.Id, ["render"] = "custom", ["layer"] = Layer,
                ["label"] = node.Label, ["description"] = node.Description, ["group_id"] = "root",
                ["position"] = new JsonObject { ["x"] = (double)(20 + index % Columns * CellW), ["y"] = (double)(top + 20 + index / Columns * CellH) },
                ["size"] = new JsonObject { ["w"] = (double)NodeW, ["h"] = (double)NodeH },
                ["meta"] = node.Status is { Length: > 0 } status ? new JsonObject { ["status"] = status } : new JsonObject(),
            });
        }
        foreach (var e in edges)
            ops.Add(new JsonObject { ["op"] = "add_edge", ["from"] = "n:" + e.From, ["to"] = "n:" + e.To, ["label"] = e.Label, ["layer"] = Layer });
        return ops;
    }
}
