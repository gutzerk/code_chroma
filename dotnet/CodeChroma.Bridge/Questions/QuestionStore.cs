using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Questions;

/// <summary>Reads and writes `question` elements only through the canvas batch write point, under the workspace canvas lock.</summary>
public static class QuestionStore
{
    private const string Explanation = "ai question";
    public const string AwaitingDelivery = "awaiting_delivery";

    // Questions a completed batch removed, per (canvas file, session_id), so later steps keep counting on.
    private static readonly Dictionary<(string Canvas, string Session), int> Delivered = new();

    // Oldest-first keys of Delivered; past the cap the oldest session drops off, so the counter stays bounded.
    private static readonly LinkedList<(string Canvas, string Session)> DeliveredOrder = new();
    private const int DeliveredCap = 512;

    // Agents with a wake-up queued, per (canvas file, agent_id); in memory, so a restart frees it.
    private static readonly ConcurrentDictionary<(string Canvas, string Agent), byte> Claims = new();

    private static JsonObject Commit(Workspace ws, Func<CanvasDoc, List<JsonNode?>> buildOps)
    {
        lock (CanvasWrite.LockFor(ws.Id))
        {
            var doc = CanvasDoc.Load(ws.CanvasCorePath(), ws.DiagramsRoot());
            var response = CanvasWrite.Commit(ws, ApplyBatch.Apply(doc, buildOps(doc), "default", Explanation));
            return Checked(response);
        }
    }

    private static JsonObject Checked(JsonObject response) =>
        Json.Bool(response["ok"]) ? response : throw new QuestionWriteException(response["errors"]?.ToJsonString() ?? "canvas write failed");

    private static CanvasDoc Load(Workspace ws) => CanvasDoc.Load(ws.CanvasCorePath(), ws.DiagramsRoot());

    private static int NextStep(Workspace ws, CanvasDoc doc, string? sessionId) =>
        string.IsNullOrEmpty(sessionId)
            ? 1
            : 1 + DeliveredCount(ws, sessionId) + doc.Elements.Values.Count(e => e.Render == "question" && Json.Str(e.Meta["session_id"]) == sessionId);

    private static int DeliveredCount(Workspace ws, string sessionId)
    {
        lock (Delivered) return Delivered.GetValueOrDefault((ws.CanvasCorePath(), sessionId));
    }

    private static void CountDelivered(Workspace ws, string sessionId)
    {
        var key = (ws.CanvasCorePath(), sessionId);
        lock (Delivered)
        {
            DeliveredOrder.Remove(key);
            DeliveredOrder.AddLast(key);
            Delivered[key] = Delivered.GetValueOrDefault(key) + 1;
            while (DeliveredOrder.Count > DeliveredCap)
            {
                Delivered.Remove(DeliveredOrder.First!.Value);
                DeliveredOrder.RemoveFirst();
            }
        }
    }

    private static JsonArray OptionsMeta(AskRequest request) => new(request.Options.Select(o => (JsonNode?)o.ToJson()).ToArray());

    private static int Step(CanvasElement element) => element.Meta["step"] is JsonValue v && v.TryGetValue(out int step) ? step : 0;

    /// <summary>Moves the draft-layer diagrams this question's options reference onto its own layer.</summary>
    /// <summary>Deletes draft diagrams nobody adopted within the TTL, so abandoned asks leave no layer.</summary>
    private static List<JsonNode?> PruneOps(CanvasDoc doc, HashSet<string> keep)
    {
        var cutoff = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0 - QuestionDiagrams.DraftTtlSeconds;
        var stale = doc.Elements.Values
            .Where(e => !keep.Contains(e.Id) && QuestionDiagrams.IsDraftLayer(e.Layer) && Json.Truthy(e.Meta["diagram_root"])
                && (e.Meta["drawn_at"] is JsonValue v && v.TryGetValue(out double drawn) ? drawn : 0) < cutoff)
            .Select(e => e.Id).ToHashSet();
        foreach (var e in doc.Elements.Values)
            if (e.GroupId is not null && stale.Contains(e.GroupId) && !keep.Contains(e.Id) && QuestionDiagrams.IsDraftLayer(e.Layer)) stale.Add(e.Id);
        return stale.Order(StringComparer.Ordinal).Select(id => (JsonNode?)new JsonObject { ["op"] = "delete_element", ["id"] = id }).ToList();
    }

    private static List<JsonNode?> AdoptOps(CanvasDoc doc, AskRequest request, string questionId)
    {
        var target = QuestionDiagrams.LayerFor(questionId, "");
        var roots = request.Options.Select(o => o.DiagramRef).Where(r => !string.IsNullOrEmpty(r) && doc.Elements.TryGetValue(r, out var e) && QuestionDiagrams.IsDraftLayer(e.Layer)).ToHashSet();
        var moved = roots.ToHashSet();
        foreach (var e in doc.Elements.Values)
            if (e.GroupId is not null && roots.Contains(e.GroupId) && QuestionDiagrams.IsDraftLayer(e.Layer)) moved.Add(e.Id);
        var ops = moved.Order(StringComparer.Ordinal).Select(id => (JsonNode?)new JsonObject { ["op"] = "update_element", ["id"] = id, ["layer"] = target }).ToList();
        ops.AddRange(PruneOps(doc, moved));
        ops.AddRange(doc.Edges.Where(kv => moved.Contains(kv.Value.From) && moved.Contains(kv.Value.To) && QuestionDiagrams.IsDraftLayer(kv.Value.Layer))
            .Select(kv => (JsonNode?)new JsonObject { ["op"] = "update_edge", ["id"] = kv.Key, ["layer"] = target }));
        return ops;
    }

    /// <summary>Adds the `question` element for a caller-chosen id; returns the element id.</summary>
    public static string OpenQuestion(Workspace ws, AskRequest request, string questionId, JsonObject? extraMeta = null)
    {
        var response = Commit(ws, doc =>
        {
            var meta = new JsonObject
            {
                ["question_id"] = questionId, ["session_id"] = request.SessionId, ["step"] = NextStep(ws, doc, request.SessionId),
                ["total"] = request.Total, ["kind"] = request.Kind, ["state"] = "open", ["answer"] = null, ["option_id"] = null,
                ["allow_custom"] = request.AllowCustom, ["allow_skip"] = request.AllowSkip, ["agent_id"] = request.AgentId,
                ["options"] = OptionsMeta(request),
            };
            foreach (var (key, value) in extraMeta ?? []) meta[key] = value?.DeepClone();
            List<JsonNode?> ops = [new JsonObject { ["op"] = "add_element", ["temp_id"] = "q", ["render"] = "question", ["layer"] = "questions", ["label"] = request.Question, ["meta"] = meta }];
            ops.AddRange(AdoptOps(doc, request, questionId));
            return ops;
        });
        return Json.Str(response["id_map"]!["q"])!;
    }

    /// <summary>The `question` element carrying this id, or null.</summary>
    public static CanvasElement? FindElement(Workspace ws, string questionId) =>
        Load(ws).Elements.Values.FirstOrDefault(e => e.Render == "question" && Json.Str(e.Meta["question_id"]) == questionId);

    /// <summary>Every `question` element, in canvas insertion order.</summary>
    public static List<CanvasElement> ListQuestions(Workspace ws) => Load(ws).Elements.Values.Where(e => e.Render == "question").ToList();

    /// <summary>Writes the answered/skipped state onto the element's meta and marks it for the agent's next wake-up.</summary>
    public static void Settle(Workspace ws, string elementId, string state, QuestionResult result) =>
        Commit(ws, _ => [Update(elementId, new JsonObject { ["state"] = state, ["answer"] = result.Answer, ["option_id"] = result.OptionId, [AwaitingDelivery] = true })]);

    /// <summary>The agent's undelivered answers, or none while any of its questions is still open.</summary>
    private static List<CanvasElement> ReadyBatch(CanvasDoc doc, string agentId)
    {
        var mine = doc.Elements.Values.Where(e => e.Render == "question" && Json.Str(e.Meta["agent_id"]) == agentId).ToList();
        return mine.Any(e => Json.Str(e.Meta["state"]) == "open") ? [] : mine.Where(e => Json.Truthy(e.Meta[AwaitingDelivery])).ToList();
    }

    /// <summary>True when the agent's batch is complete and no wake-up for it is queued yet; claims it.</summary>
    public static bool ClaimBatch(Workspace ws, string agentId) =>
        ReadyBatch(Load(ws), agentId).Count > 0 && Claims.TryAdd((ws.CanvasCorePath(), agentId), 0);

    /// <summary>The batch as it stands now, read at typing time so a revise or late answer is current.</summary>
    public static List<CanvasElement> PendingBatch(Workspace ws, string agentId) => ReadyBatch(Load(ws), agentId);

    /// <summary>Drops the agent's claim; its untyped answers stay marked for the next wake-up.</summary>
    public static void ReleaseBatch(Workspace ws, string agentId) => Claims.TryRemove((ws.CanvasCorePath(), agentId), out _);

    /// <summary>After the answers were typed: deletes the batch's questions that still hold the typed answer, and their option diagrams.</summary>
    public static void ClearBatch(Workspace ws, List<CanvasElement> batch)
    {
        lock (CanvasWrite.LockFor(ws.Id))
        {
            var doc = Load(ws);
            var settled = StillSettled(doc, batch);
            if (settled.Count == 0) return;
            CommitLocked(ws, doc, CleanupOps(doc, settled));
            foreach (var session in settled.Select(e => Json.Str(e.Meta["session_id"])).OfType<string>().Where(id => id.Length > 0))
                CountDelivered(ws, session);
        }
    }

    private static readonly string[] SettledKeys = ["state", "answer", "option_id"];

    /// <summary>The batch's questions still on the canvas with the very answer that was typed.</summary>
    private static List<CanvasElement> StillSettled(CanvasDoc doc, List<CanvasElement> batch) =>
        batch.Select(typed => doc.Elements.TryGetValue(typed.Id, out var current)
                && SettledKeys.All(k => JsonNode.DeepEquals(current.Meta[k], typed.Meta[k])) ? current : null)
            .OfType<CanvasElement>().ToList();

    /// <summary>Commits `ops` against an already-loaded doc; the caller holds the canvas lock.</summary>
    private static void CommitLocked(Workspace ws, CanvasDoc doc, List<JsonNode?> ops) =>
        Checked(CanvasWrite.Commit(ws, ApplyBatch.ApplyChunked(doc, ops, "default", Explanation, confirmMassDelete: true)));

    /// <summary>Deletes the questions, their `decisions/&lt;question id&gt;` layers and the decision diagrams their options reference.</summary>
    private static List<JsonNode?> CleanupOps(CanvasDoc doc, List<CanvasElement> questions)
    {
        var layers = questions.Select(q => Json.Str(q.Meta["question_id"])).OfType<string>().Where(id => id.Length > 0).Select(id => QuestionDiagrams.LayerFor(id, "")).ToHashSet();
        var roots = questions.SelectMany(q => q.Meta["options"] as JsonArray ?? []).Select(o => Json.Str(o?["diagram_ref"]))
            .OfType<string>().Where(r => doc.Elements.TryGetValue(r, out var root) && QuestionDiagrams.IsDecisionLayer(root.Layer)).ToHashSet();
        var doomed = questions.Select(q => q.Id).ToHashSet();
        foreach (var e in doc.Elements.Values)
            if (layers.Contains(e.Layer) || roots.Contains(e.Id) || (e.GroupId is not null && roots.Contains(e.GroupId) && QuestionDiagrams.IsDecisionLayer(e.Layer))) doomed.Add(e.Id);
        return doomed.Order(StringComparer.Ordinal).Select(id => (JsonNode?)new JsonObject { ["op"] = "delete_element", ["id"] = id }).ToList();
    }

    /// <summary>The settled result recorded on an element, or null while it is still open.</summary>
    public static QuestionResult? ResultFrom(CanvasElement element) => Json.Str(element.Meta["state"]) switch
    {
        "answered" => new QuestionResult { Answer = Json.Str(element.Meta["answer"]), OptionId = Json.Str(element.Meta["option_id"]) },
        "skipped" => new QuestionResult { Skipped = true },
        _ => null,
    };

    /// <summary>Reopens a question and deletes later steps of its session; returns the deleted ids.</summary>
    public static List<string> Reopen(Workspace ws, CanvasElement element)
    {
        var sessionId = Json.Str(element.Meta["session_id"]);
        var step = Step(element);
        var later = ListQuestions(ws)
            .Where(e => !string.IsNullOrEmpty(sessionId) && Json.Str(e.Meta["session_id"]) == sessionId && Step(e) > step)
            .Select(e => e.Id).ToList();
        var ops = later.Select(id => (JsonNode?)new JsonObject { ["op"] = "delete_element", ["id"] = id }).ToList();
        ops.Add(Update(element.Id, new JsonObject { ["state"] = "open", ["answer"] = null, ["option_id"] = null, ["revised"] = true }));
        Commit(ws, _ => ops);
        return later;
    }

    /// <summary>Every element id on the canvas, for checking `diagram_ref`.</summary>
    public static HashSet<string> KnownElementIds(Workspace ws) => [.. Load(ws).Elements.Keys];

    /// <summary>The open diagram-requested card this re-ask continues, and its older duplicates.</summary>
    public static (CanvasElement Keep, List<CanvasElement> Stale)? FindDiagramRequested(Workspace ws, AskRequest request)
    {
        var pending = ListQuestions(ws).Where(e => Json.Str(e.Meta["state"]) == "open" && Json.Truthy(e.Meta["diagram_requested"])).ToList();
        var pool = !string.IsNullOrEmpty(request.SessionId)
            ? pending.Where(e => Json.Str(e.Meta["session_id"]) == request.SessionId).ToList()
            : pending.Where(e => string.IsNullOrEmpty(Json.Str(e.Meta["session_id"])) && e.Label == request.Question).ToList();
        return pool.Count == 0 ? null : (pool[^1], pool[..^1]);
    }

    /// <summary>Updates the question in place with the re-asked options and skips its older duplicates.</summary>
    public static void Reask(Workspace ws, CanvasElement element, AskRequest request, JsonObject? extraMeta, IEnumerable<CanvasElement>? stale = null)
    {
        var meta = new JsonObject
        {
            ["options"] = OptionsMeta(request), ["kind"] = request.Kind, ["diagram_requested"] = false, ["revised"] = false,
            ["allow_custom"] = request.AllowCustom, ["allow_skip"] = request.AllowSkip,
            ["session_id"] = request.SessionId, ["total"] = request.Total, ["degraded"] = false, ["validation"] = null,
        };
        foreach (var (key, value) in extraMeta ?? []) meta[key] = value?.DeepClone();
        var ops = (stale ?? []).Select(old => (JsonNode?)Update(old.Id, new JsonObject { ["state"] = "skipped", ["answer"] = null, ["option_id"] = null })).ToList();
        var update = Update(element.Id, meta);
        update["label"] = request.Question;
        ops.Add(update);
        var questionId = Json.Str(element.Meta["question_id"])!;
        Commit(ws, doc => [.. ops, .. AdoptOps(doc, request, questionId)]);
    }

    /// <summary>Records the user's "Add diagram" request on the element's meta.</summary>
    public static void RequestDiagram(Workspace ws, CanvasElement element, string requestedAt)
    {
        var count = element.Meta["diagram_requests"] is JsonValue v && v.TryGetValue(out int n) ? n : 0;
        Commit(ws, _ => [Update(element.Id, new JsonObject { ["diagram_requested"] = true, ["diagram_requested_at"] = requestedAt, ["diagram_requests"] = count + 1 })]);
    }

    private static JsonObject Update(string id, JsonObject meta) => new() { ["op"] = "update_element", ["id"] = id, ["meta"] = meta };

    /// <summary>The y to start a new diagram at: below its own question's diagrams, else below every `decisions/*` layer, so dragged diagrams never overlap.</summary>
    private static double NextTop(CanvasDoc doc, string layer)
    {
        List<double> Bottoms(Func<string, bool> match) => doc.Elements.Values.Where(e => match(e.Layer)).Select(e => e.Position.Y + (e.Size?.H ?? 0) / 2).ToList();
        var bottoms = Bottoms(l => l == layer);
        if (bottoms.Count == 0) bottoms = Bottoms(l => l.StartsWith(QuestionDiagrams.LayerPrefix, StringComparison.Ordinal));
        return bottoms.Count == 0 ? 0 : bottoms.Max() + QuestionDiagrams.Gap;
    }

    /// <summary>Draws one option diagram on its `decisions/<question id>` layer (a fresh key when no question is named) and returns its root id (the ref); nothing is drawn if the option is unknown.</summary>
    public static string DrawDiagram(Workspace ws, string title, IReadOnlyList<DiagramNode> nodes, IReadOnlyList<DiagramEdge> edges, string? questionId, string? optionId)
    {
        lock (CanvasWrite.LockFor(ws.Id))
        {
            var doc = Load(ws);
            CanvasElement? target = null;
            if (!string.IsNullOrEmpty(questionId))
            {
                target = doc.Elements.Values.FirstOrDefault(e => e.Render == "question" && Json.Str(e.Meta["question_id"]) == questionId)
                    ?? throw new QuestionWriteException($"unknown question '{questionId}'");
                var optionIds = (target.Meta["options"] as JsonArray ?? []).Select(o => Json.Str(o?["id"])).ToHashSet();
                if (optionId is null || !optionIds.Contains(optionId)) throw new QuestionWriteException($"unknown option '{optionId}' on that question");
            }
            var layer = QuestionDiagrams.LayerFor(questionId, Guid.NewGuid().ToString("N")[..8]);
            var result = ApplyBatch.Apply(doc, QuestionDiagrams.Ops(title, nodes, edges, NextTop(doc, layer), optionId, layer), "default", Explanation);
            if (result.Ok && target is not null)
            {
                var rootId = result.IdMap["root"];
                var options = new JsonArray((target.Meta["options"] as JsonArray ?? []).Select(o =>
                {
                    var copy = (JsonObject)o!.DeepClone();
                    if (Json.Str(copy["id"]) == optionId) copy["diagram_ref"] = rootId;
                    return (JsonNode?)copy;
                }).ToArray());
                var second = ApplyBatch.Apply(result.Doc!, [Update(target.Id, new JsonObject { ["options"] = options })], "default", Explanation);
                result = second.Ok
                    ? new BatchResult { Ok = true, Doc = second.Doc, IdMap = result.IdMap, Affected = [.. result.Affected.Concat(second.Affected).Distinct().Order(StringComparer.Ordinal)] }
                    : second;
            }
            var response = Checked(CanvasWrite.Commit(ws, result));
            return Json.Str(response["id_map"]!["root"])!;
        }
    }
}
