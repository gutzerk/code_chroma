using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Questions;

/// <summary>Reads and writes `question` elements only through ApplyBatch under the workspace canvas lock (questions/store.py).</summary>
public static class QuestionStore
{
    private const string Explanation = "ai question";

    /// <summary>Loads the doc once under the canvas lock, builds the ops from it, applies and commits them.</summary>
    private static JsonObject Commit(Workspace ws, Func<CanvasDoc, List<JsonNode?>> buildOps)
    {
        lock (CanvasWrite.LockFor(ws.Id))
        {
            var doc = Load(ws);
            return Checked(CanvasWrite.Commit(ws, ApplyBatch.Apply(doc, buildOps(doc), "default", Explanation)));
        }
    }

    private static JsonObject Checked(JsonObject response) =>
        Json.Bool(response["ok"]) ? response : throw new QuestionWriteException(response["errors"]?.ToJsonString() ?? "canvas write failed");

    private static CanvasDoc Load(Workspace ws) => CanvasDoc.Load(ws.CanvasCorePath(), ws.DiagramsRoot());

    private static IEnumerable<CanvasElement> Questions(CanvasDoc doc) => doc.Elements.Values.Where(e => e.Render == "question");

    private static CanvasElement? ByQuestionId(CanvasDoc doc, string questionId) => Questions(doc).FirstOrDefault(e => Json.Str(e.Meta["question_id"]) == questionId);

    private static int StepOf(CanvasElement element) => Json.IntOrNull(element.Meta["step"]) ?? 0;

    private static string? SessionOf(CanvasElement element) => Json.Str(element.Meta["session_id"]);

    private static int NextStep(CanvasDoc doc, string? sessionId) =>
        string.IsNullOrEmpty(sessionId) ? 1 : 1 + Questions(doc).Count(e => SessionOf(e) == sessionId);

    private static JsonObject StateMeta(string state, string? answer, string? optionId) => new() { ["state"] = state, ["answer"] = answer, ["option_id"] = optionId };

    private static JsonObject Update(string id, JsonObject meta, string? label = null)
    {
        var op = new JsonObject { ["op"] = "update_element", ["id"] = id, ["meta"] = meta };
        if (label is not null) op["label"] = label;
        return op;
    }

    /// <summary>Adds the question element for a caller-chosen id; returns the element id.</summary>
    public static string OpenQuestion(Workspace ws, AskRequest request, string questionId, JsonObject? extraMeta = null)
    {
        var response = Commit(ws, doc =>
        {
            var meta = new JsonObject
            {
                ["question_id"] = questionId, ["session_id"] = request.SessionId, ["step"] = NextStep(doc, request.SessionId),
                ["total"] = request.Total, ["kind"] = request.Kind, ["state"] = "open", ["answer"] = null, ["option_id"] = null,
                ["allow_custom"] = request.AllowCustom, ["allow_skip"] = request.AllowSkip, ["agent_id"] = request.AgentId,
                ["options"] = request.OptionsJson(),
            };
            Json.CopyInto(meta, extraMeta);
            return [new JsonObject { ["op"] = "add_element", ["temp_id"] = "q", ["render"] = "question", ["layer"] = "questions", ["label"] = request.Question, ["meta"] = meta }];
        });
        return Json.Str(response["id_map"]?["q"])!;
    }

    /// <summary>The `question` element carrying this id, or null.</summary>
    public static CanvasElement? FindElement(Workspace ws, string questionId) => ByQuestionId(Load(ws), questionId);

    /// <summary>Every `question` element, in canvas insertion order.</summary>
    public static List<CanvasElement> ListQuestions(Workspace ws) => Questions(Load(ws)).ToList();

    public static string State(CanvasElement element) => Json.Str(element.Meta["state"]) ?? "";

    /// <summary>Writes the answered/skipped state onto the element's meta.</summary>
    public static void Settle(Workspace ws, string elementId, string state, QuestionResult result) =>
        Commit(ws, _ => [Update(elementId, StateMeta(state, result.Answer, result.OptionId))]);

    /// <summary>The settled result recorded on an element, or null while it is still open.</summary>
    public static QuestionResult? ResultFrom(CanvasElement element) => State(element) switch
    {
        "answered" => new QuestionResult(Answer: Json.Str(element.Meta["answer"]), OptionId: Json.Str(element.Meta["option_id"])),
        "skipped" => new QuestionResult(Skipped: true),
        _ => null,
    };

    /// <summary>Reopens a question and deletes later steps of its session; returns the deleted ids.</summary>
    public static List<string> Reopen(Workspace ws, CanvasElement element)
    {
        var later = new List<string>();
        Commit(ws, doc =>
        {
            var current = doc.Elements.TryGetValue(element.Id, out var found) ? found : element;
            var sessionId = SessionOf(current);
            if (!string.IsNullOrEmpty(sessionId))
                later.AddRange(Questions(doc).Where(e => SessionOf(e) == sessionId && StepOf(e) > StepOf(current)).Select(e => e.Id));
            var ops = later.Select(id => (JsonNode?)new JsonObject { ["op"] = "delete_element", ["id"] = id }).ToList();
            ops.Add(Update(element.Id, StateMeta("open", null, null)));
            return ops;
        });
        return later;
    }

    /// <summary>Every element id on the canvas, for checking diagram_ref.</summary>
    public static HashSet<string> KnownElementIds(Workspace ws) => [.. Load(ws).Elements.Keys];

    private static List<CanvasElement> DiagramRequested(CanvasDoc doc, AskRequest request)
    {
        var pending = Questions(doc).Where(e => State(e) == "open" && Json.Truthy(e.Meta["diagram_requested"]));
        return (!string.IsNullOrEmpty(request.SessionId)
            ? pending.Where(e => SessionOf(e) == request.SessionId)
            : pending.Where(e => string.IsNullOrEmpty(SessionOf(e)) && e.Label == request.Question)).ToList();
    }

    /// <summary>The open diagram-requested card this re-ask continues, and its older duplicates.</summary>
    public static (CanvasElement Keep, List<CanvasElement> Stale)? FindDiagramRequested(Workspace ws, AskRequest request)
    {
        var pool = DiagramRequested(Load(ws), request);
        return pool.Count == 0 ? null : (pool[^1], pool[..^1]);
    }

    /// <summary>Updates the question in place with the re-asked options and skips its older duplicates (found again under the lock).</summary>
    public static void Reask(Workspace ws, CanvasElement element, AskRequest request, JsonObject? extraMeta)
    {
        Commit(ws, doc =>
        {
            var meta = new JsonObject
            {
                ["options"] = request.OptionsJson(), ["kind"] = request.Kind, ["diagram_requested"] = false,
                ["allow_custom"] = request.AllowCustom, ["allow_skip"] = request.AllowSkip,
                ["session_id"] = request.SessionId, ["total"] = request.Total, ["degraded"] = false, ["validation"] = null,
            };
            Json.CopyInto(meta, extraMeta);
            var ops = DiagramRequested(doc, request).Where(e => e.Id != element.Id)
                .Select(old => (JsonNode?)Update(old.Id, StateMeta("skipped", null, null))).ToList();
            ops.Add(Update(element.Id, meta, request.Question));
            return ops;
        });
    }

    /// <summary>Records the user's "Add diagram" request on the element's meta.</summary>
    public static void RequestDiagram(Workspace ws, CanvasElement element, string requestedAt)
    {
        var count = Json.IntOrNull(element.Meta["diagram_requests"]) ?? 0;
        Commit(ws, _ => [Update(element.Id, new JsonObject { ["diagram_requested"] = true, ["diagram_requested_at"] = requestedAt, ["diagram_requests"] = count + 1 })]);
    }

    private static int NextBand(CanvasDoc doc) =>
        doc.Elements.Values.Where(e => Json.Truthy(e.Meta["diagram_root"])).Select(e => (int)Math.Floor(e.Position.Y / OptionDiagrams.BandHeight)).DefaultIfEmpty(-1).Max() + 1;

    /// <summary>The first apply's result carrying the second apply's doc, so one commit saves both.</summary>
    private static BatchResult Chain(BatchResult first, BatchResult second) => second.Ok
        ? new BatchResult { Ok = true, Doc = second.Doc, IdMap = first.IdMap, Affected = first.Affected.Concat(second.Affected).Distinct().Order(StringComparer.Ordinal).ToList() }
        : second;

    /// <summary>Draws one option diagram on the `decisions` layer and returns its root id (the ref); with a question and option the ref is attached in the same commit.</summary>
    public static string DrawDiagram(Workspace ws, string title, IReadOnlyList<DiagramNode> nodes, IReadOnlyList<DiagramEdge> edges, string? questionId, string? optionId)
    {
        lock (CanvasWrite.LockFor(ws.Id))
        {
            var doc = Load(ws);
            CanvasElement? target = null;
            if (!string.IsNullOrEmpty(questionId))
            {
                target = ByQuestionId(doc, questionId) ?? throw new QuestionWriteException($"unknown question '{questionId}'");
                var known = (target.Meta["options"] as JsonArray ?? []).Select(o => Json.Str(o?["id"])).ToHashSet();
                if (optionId is null || !known.Contains(optionId)) throw new QuestionWriteException($"unknown option '{optionId}' on that question");
            }
            var result = ApplyBatch.Apply(doc, OptionDiagrams.Ops(title, nodes, edges, NextBand(doc), optionId), "default", Explanation);
            if (result.Ok && target is not null)
            {
                // The ref is the minted root id, which a meta value cannot name by temp id, so a second apply attaches it.
                var rootId = result.IdMap["root"];
                var options = new JsonArray((target.Meta["options"] as JsonArray ?? []).Select(o =>
                {
                    var copy = (JsonObject)o!.DeepClone();
                    if (Json.Str(copy["id"]) == optionId) copy["diagram_ref"] = rootId;
                    return (JsonNode?)copy;
                }).ToArray());
                result = Chain(result, ApplyBatch.Apply(result.Doc!, [Update(target.Id, new JsonObject { ["options"] = options })], "default", Explanation));
            }
            return Json.Str(Checked(CanvasWrite.Commit(ws, result))["id_map"]?["root"])!;
        }
    }
}
