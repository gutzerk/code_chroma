using System.Text.Json.Nodes;
using CodeChroma.Bridge.Live;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Questions;

/// <summary>One agent's questions as its window shows them, read through the bridge's own workspace mapping without bringing a workspace up.</summary>
public static class AgentQuestionView
{
    /// <summary>The most elements one option diagram contributes, the cap the window's renderer walks with.</summary>
    public const int MaxDiagramNodes = 40;

    /// <summary>GET /agents/{id}/questions: open questions, their session history and option-diagram subgraphs, as a small canvas doc.</summary>
    public static JsonObject Read(WorkspaceRegistry registry, string agentId)
    {
        var (workspace, doc) = Load(registry, agentId);
        var open = OpenQuestions(doc, agentId);
        var sessions = open.Select(e => Json.Str(e.Meta["session_id"])).OfType<string>().Where(s => s.Length > 0).ToHashSet();
        var keep = open.Select(e => e.Id).ToHashSet();
        foreach (var e in doc.Elements.Values)
            if (e.Render == "question" && !IsOpen(e) && Json.Str(e.Meta["agent_id"]) == agentId && Json.Str(e.Meta["session_id"]) is { Length: > 0 } session && sessions.Contains(session)) keep.Add(e.Id);
        var roots = open.SelectMany(q => q.Meta["options"] as JsonArray ?? []).Select(o => Json.Str(o?["diagram_ref"])).OfType<string>().Where(r => r.Length > 0);
        var diagram = new HashSet<string>();
        foreach (var root in roots) diagram.UnionWith(Subgraph(doc, root));
        keep.UnionWith(diagram);
        var elements = new JsonObject();
        foreach (var (id, element) in doc.Elements)
            if (keep.Contains(id)) elements[id] = element.ToJson();
        var edges = new JsonObject();
        foreach (var (id, edge) in doc.Edges)
            if (diagram.Contains(edge.From) && diagram.Contains(edge.To)) edges[id] = edge.ToJson();
        return new JsonObject
        {
            ["agent_id"] = agentId, ["workspace"] = workspace, ["open_questions"] = open.Count,
            ["elements"] = elements, ["edges"] = edges,
        };
    }

    /// <summary>How many questions the agent has open in the workspace it asks into.</summary>
    public static int OpenCount(WorkspaceRegistry registry, string agentId) => OpenQuestions(Load(registry, agentId).Doc, agentId).Count;

    private static bool IsOpen(CanvasElement element) => (Json.Str(element.Meta["state"]) ?? "open") == "open";

    private static List<CanvasElement> OpenQuestions(CanvasDoc doc, string agentId) =>
        [.. doc.Elements.Values.Where(e => e.Render == "question" && Json.Str(e.Meta["agent_id"]) == agentId && IsOpen(e))
            .OrderBy(e => e.Meta["step"] is JsonValue v && v.TryGetValue(out double step) ? step : 0)];

    /// <summary>The workspace an agent's ask_user writes to (the one its MCP token resolves to) and its canvas, read from disk.</summary>
    private static (string Workspace, CanvasDoc Doc) Load(WorkspaceRegistry registry, string agentId)
    {
        var (workspace, root) = registry.Resolve(agentId);
        var dir = Path.Combine(root, ".codechroma");
        lock (CanvasWrite.LockFor(workspace)) return (workspace, CanvasDoc.Load(Path.Combine(dir, "canvas-core.json"), Path.Combine(dir, "diagrams")));
    }

    /// <summary>The option diagram's root, its group members and what its arrows reach, in the order the window's renderer walks them.</summary>
    private static HashSet<string> Subgraph(CanvasDoc doc, string rootId)
    {
        if (!doc.Elements.ContainsKey(rootId)) return [];
        var seen = new List<string> { rootId };
        var queue = new Queue<string>([rootId]);
        while (queue.Count > 0 && seen.Count < MaxDiagramNodes)
        {
            var id = queue.Dequeue();
            var next = doc.Edges.Values.Where(e => e.From == id).Select(e => e.To)
                .Concat(doc.Elements.Values.Where(e => e.GroupId == id).Select(e => e.Id));
            foreach (var n in next)
            {
                if (!doc.Elements.ContainsKey(n) || seen.Contains(n) || seen.Count >= MaxDiagramNodes) continue;
                seen.Add(n);
                queue.Enqueue(n);
            }
        }
        return [.. seen];
    }
}

/// <summary>Pushes `agent-questions` (the agent id and its open count) to every canvas whenever an agent's questions change.</summary>
public sealed class AgentQuestionEvents(WorkspaceRegistry registry, ConnectionManager connections)
{
    public const string Type = "agent-questions";

    /// <summary>Never throws: a failed count or send must not fail the write that triggered it.</summary>
    public void Changed(string? agentId)
    {
        if (string.IsNullOrEmpty(agentId)) return;
        try
        {
            var open = AgentQuestionView.OpenCount(registry, agentId);
            connections.BroadcastDetached(new JsonObject { ["type"] = Type, ["id"] = agentId, ["open_questions"] = open });
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"questions: could not announce the questions of agent {agentId}: {error.Message}");
        }
    }
}
