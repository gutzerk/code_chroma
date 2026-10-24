using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Routes;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Diagrams;

/// <summary>The sequence diagram's generation_data: the newest recorded trace reduced to participants and direct-call messages (context_providers.py).</summary>
public static class SequenceContext
{
    /// <summary>Caps the scaffold so a hot trace stays a readable skeleton.</summary>
    public const int MaxMessages = 60;

    public static JsonObject Build(Workspace ws)
    {
        var traces = TraceRoutes.ListSummaries(ws.TracesDir);
        var scaffold = new JsonObject { ["traces"] = new JsonArray(traces.Select(t => (JsonNode?)t).ToArray()) };
        if (traces.Count == 0) return scaffold;
        var trace = TraceRoutes.Load(ws.TracesDir, Json.Str(traces[0]["id"]) ?? "");
        scaffold["trace"] = trace;
        var (participants, messages) = Scaffold(trace as JsonObject);
        scaffold["participants"] = participants;
        scaffold["messages"] = messages;
        return scaffold;
    }

    /// <summary>One participant per anchored node id and one message per distinct direct caller-to-callee hop; returns are dropped.</summary>
    public static (JsonArray Participants, JsonArray Messages) Scaffold(JsonObject? trace)
    {
        var participants = new JsonArray();
        var messages = new JsonArray();
        var index = new Dictionary<string, int>(StringComparer.Ordinal);
        var seen = new HashSet<(string From, string To, string Args)>();

        int Participant(string nodeId)
        {
            if (index.TryGetValue(nodeId, out var known)) return known;
            var at = participants.Count;
            var split = nodeId.LastIndexOf("::", StringComparison.Ordinal);
            participants.Add(new JsonObject { ["id"] = nodeId, ["name"] = split < 0 ? nodeId : nodeId[(split + 2)..], ["node_id"] = nodeId });
            index[nodeId] = at;
            return at;
        }

        foreach (var step in (trace?["steps"] as JsonArray)?.OfType<JsonObject>() ?? [])
        {
            if (Json.Str(step["event"]) != "call") continue;
            if (Json.Str(step["caller_node_id"]) is not { } caller || Json.Str(step["node_id"]) is not { } callee || caller == callee) continue;
            if (messages.Count >= MaxMessages) break;
            var args = step["args"];
            var argsKey = Truthy(args) ? args!.ToString() : "";
            var from = Participant(caller);
            var to = Participant(callee);
            if (!seen.Add((caller, callee, argsKey))) continue;
            messages.Add(new JsonObject
            {
                ["order"] = messages.Count + 1,
                ["from_idx"] = from,
                ["to_idx"] = to,
                ["from"] = caller,
                ["to"] = callee,
                ["args"] = args?.DeepClone(),
            });
        }
        return (participants, messages);
    }

    private static bool Truthy(JsonNode? node) => node is not null && !(node is JsonValue v && v.ToString() is "" or "0" or "false") && !(node is JsonArray { Count: 0 }) && !(node is JsonObject { Count: 0 });
}
