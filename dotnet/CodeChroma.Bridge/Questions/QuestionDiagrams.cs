using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Questions;

/// <summary>One box; Status "new" outlines a part that does not exist in the code yet.</summary>
public sealed record DiagramNode(string Id, string Label, string Description = "", string? Status = null);

/// <summary>One arrow between two node ids of the same diagram.</summary>
public sealed record DiagramEdge(string From, string To, string Label = "");

/// <summary>Small per-option decision diagrams: budget check and the canvas ops that draw one.</summary>
public static class QuestionDiagrams
{
    public const string Layer = "decisions";
    public const int MaxNodes = 12;
    public const int MaxId = 40;
    public const int MaxTitle = 80;
    public const int MaxLabel = 60;
    public const int MaxDescription = 300;
    private const int Columns = 4;
    private const int CellW = 200, CellH = 100;
    private const int NodeW = 160, NodeH = 60;
    public const int BandH = 3 * CellH + 80;

    private static int Len(string text) => text.EnumerateRunes().Count();

    /// <summary>One line per budget, length or reference problem; mirrors the skill's check script.</summary>
    public static List<string> Validate(IReadOnlyList<DiagramNode> nodes, IReadOnlyList<DiagramEdge> edges, string title)
    {
        var found = new List<string>();
        if (string.IsNullOrWhiteSpace(title)) found.Add("title is empty");
        else if (Len(title) > MaxTitle) found.Add($"title is longer than {MaxTitle} characters");
        if (nodes.Count < 1 || nodes.Count > MaxNodes) found.Add($"give 1-{MaxNodes} nodes, got {nodes.Count}");
        var ids = nodes.Select(n => n.Id).ToList();
        if (ids.Distinct().Count() != ids.Count) found.Add("node ids are not unique");
        foreach (var n in nodes)
        {
            if (string.IsNullOrWhiteSpace(n.Id)) found.Add("node with empty id");
            else if (Len(n.Id) > MaxId) found.Add($"node \"{n.Id}\": id is longer than {MaxId} characters");
            if (string.IsNullOrWhiteSpace(n.Label)) found.Add($"node \"{n.Id}\": empty label");
            else if (Len(n.Label) > MaxLabel) found.Add($"node \"{n.Id}\": label is longer than {MaxLabel} characters");
            if (Len(n.Description) > MaxDescription) found.Add($"node \"{n.Id}\": description is longer than {MaxDescription} characters");
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

    /// <summary>Throws QuestionRejected with every problem, in the tool-error shape.</summary>
    public static void Check(IReadOnlyList<DiagramNode> nodes, IReadOnlyList<DiagramEdge> edges, string title)
    {
        var problems = Validate(nodes, edges, title);
        if (problems.Count > 0) throw new QuestionRejected(QuestionValidation.RejectionText(problems, "diagram"));
    }

    /// <summary>The ops for one diagram: a group root, its nodes in a grid, then the arrows.</summary>
    public static List<JsonNode?> Ops(string title, IReadOnlyList<DiagramNode> nodes, IReadOnlyList<DiagramEdge> edges, int band, string? optionId)
    {
        var top = band * BandH;
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
                ["meta"] = string.IsNullOrEmpty(node.Status) ? new JsonObject() : new JsonObject { ["status"] = node.Status },
            });
        }
        foreach (var e in edges)
            ops.Add(new JsonObject { ["op"] = "add_edge", ["from"] = "n:" + e.From, ["to"] = "n:" + e.To, ["label"] = e.Label, ["layer"] = Layer });
        return ops;
    }

    /// <summary>Reads `nodes` from tool arguments.</summary>
    public static List<DiagramNode> ParseNodes(JsonNode? raw)
    {
        if (raw is not JsonArray array) throw new QuestionRejected("draw_option_diagram: nodes must be an array");
        var nodes = new List<DiagramNode>();
        for (var i = 0; i < array.Count; i++)
        {
            if (array[i] is not JsonObject o) throw new QuestionRejected($"nodes[{i}] must be an object");
            var where = $"nodes[{i}]";
            nodes.Add(new DiagramNode(ArgReader.Required(o, "id", where), ArgReader.Required(o, "label", where), ArgReader.Text(o, "description", where), ArgReader.OptionalText(o, "status", where)));
        }
        return nodes;
    }

    /// <summary>Reads `edges` from tool arguments (absent means none).</summary>
    public static List<DiagramEdge> ParseEdges(JsonNode? raw)
    {
        if (raw is null) return [];
        if (raw is not JsonArray array) throw new QuestionRejected("draw_option_diagram: edges must be an array");
        var edges = new List<DiagramEdge>();
        for (var i = 0; i < array.Count; i++)
        {
            if (array[i] is not JsonObject o) throw new QuestionRejected($"edges[{i}] must be an object");
            var where = $"edges[{i}]";
            edges.Add(new DiagramEdge(ArgReader.Required(o, "from", where), ArgReader.Required(o, "to", where), ArgReader.Text(o, "label", where)));
        }
        return edges;
    }
}
