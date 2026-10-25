using System.Text.Json.Nodes;
using CodeChroma.Bridge.Diagrams;
using CodeChroma.Bridge.Epics;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;
using CodeChroma.Core.Patterns;

namespace CodeChroma.Bridge.Routes;

/// <summary>GET /repos/{id}/{kind}/context: the unified {coverage, staleness, generation_data} envelope per built-in diagram kind.</summary>
public static class ContextRoutes
{
    /// <summary>Kinds with a context envelope here.</summary>
    public static readonly IReadOnlyList<string> Kinds = ["c1", "epics", "patterns", "impact", "sequence"];

    /// <summary>The most direct-call messages a recorded trace may contribute to the sequence scaffold.</summary>
    private const int SequenceTraceMessages = 60;

    public static void Map(WebApplication app)
    {
        var parser = DiffRoutes.ParserFor(app);
        foreach (var kind in Kinds)
        {
            var k = kind;
            app.MapGet($"/repos/{{repoId}}/{k}/context", (string repoId, string? source, string? feature, WorkspaceRegistry registry) =>
                Reply.Json(Envelope(registry.Get(repoId), k, parser, source ?? "diff", feature)));
        }
    }

    public static JsonObject Envelope(Workspace ws, string kind, IOldSymbolParser parser, string source = "diff", string? feature = null) => new()
    {
        ["coverage"] = null,
        ["staleness"] = kind == "patterns" ? PatternsStaleness(ws) : null,
        ["generation_data"] = kind switch
        {
            "epics" => EpicsAssembler.For(ws.Root).Index(),
            "patterns" => ws.Engine.PatternsContext(),
            "impact" => ImpactContext.Build(ws, parser, source, feature),
            "sequence" => SequenceScaffold(ws),
            _ => null,
        },
    };

    /// <summary>The newest recorded trace plus its participant/message skeleton (just the traces list when none exist).</summary>
    public static JsonObject SequenceScaffold(Workspace ws)
    {
        var traces = TraceRoutes.ListSummaries(ws.TracesDir);
        var scaffold = new JsonObject { ["traces"] = new JsonArray(traces.Select(t => (JsonNode?)t).ToArray()) };
        if (traces.Count == 0) return scaffold;
        var trace = TraceRoutes.Load(ws.TracesDir, Json.Str(traces[0]["id"]) ?? "");
        scaffold["trace"] = trace;
        var (participants, messages) = SequenceParts(trace);
        scaffold["participants"] = participants;
        scaffold["messages"] = messages;
        return scaffold;
    }

    /// <summary>Distinct participants and first direct caller-to-callee hops from a trace's call steps, bounded.</summary>
    private static (JsonArray Participants, JsonArray Messages) SequenceParts(JsonNode trace)
    {
        var participants = new JsonArray();
        var index = new Dictionary<string, int>();
        var messages = new JsonArray();
        int Participant(string nodeId)
        {
            if (index.TryGetValue(nodeId, out var got)) return got;
            var at = participants.Count;
            participants.Add(new JsonObject { ["id"] = nodeId, ["name"] = nodeId.Split("::")[^1], ["node_id"] = nodeId });
            index[nodeId] = at;
            return at;
        }
        foreach (var step in (trace["steps"] as JsonArray) ?? [])
        {
            if (step is not JsonObject o || Json.Str(o["event"]) != "call") continue;
            var caller = StringOf(o["caller_node_id"]);
            var callee = StringOf(o["node_id"]);
            if (caller is null || callee is null || caller == callee) continue;
            if (messages.Count >= SequenceTraceMessages) break;
            var from = Participant(caller);
            var to = Participant(callee);
            var args = o["args"];
            // Mirrors the reference: only a string args value can match an earlier message for dedup.
            var key = StringOf(args) ?? (Falsy(args) ? "" : null);
            if (key is not null && messages.OfType<JsonObject>().Any(m =>
                    Json.Str(m["from"]) == caller && Json.Str(m["to"]) == callee && StringOf(m["args"]) == key))
                continue;
            messages.Add(new JsonObject
            {
                ["order"] = messages.Count + 1, ["from_idx"] = from, ["to_idx"] = to,
                ["from"] = caller, ["to"] = callee, ["args"] = args?.DeepClone(),
            });
        }
        return (participants, messages);
    }

    private static string? StringOf(JsonNode? node) => node is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    private static bool Falsy(JsonNode? node) => node switch
    {
        null => true,
        JsonArray a => a.Count == 0,
        JsonObject o => o.Count == 0,
        JsonValue v when v.TryGetValue<bool>(out var b) => !b,
        JsonValue v when v.TryGetValue<double>(out var n) => n == 0,
        _ => false,
    };

    /// <summary>Live candidates vs what was reviewed, the same signal the resolved patterns diagram carries.</summary>
    private static JsonObject PatternsStaleness(Workspace ws)
    {
        var authored = DiagramArtifacts.Load(ws, "patterns");
        var fingerprint = PatternSerialize.FingerprintFor(ws.Engine.PatternCandidates());
        return DiagramResolver.AttachStaleness(new JsonObject(), fingerprint, Json.Str(authored["fingerprint"]));
    }
}
