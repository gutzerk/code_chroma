using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Questions;

/// <summary>Reads and writes `question` elements only through the canvas batch write point, under the workspace canvas lock.</summary>
public static class QuestionStore
{
    private const string Explanation = "ai question";

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

    private static int NextStep(CanvasDoc doc, string? sessionId) =>
        string.IsNullOrEmpty(sessionId) ? 1 : 1 + doc.Elements.Values.Count(e => e.Render == "question" && Json.Str(e.Meta["session_id"]) == sessionId);

    private static JsonArray OptionsMeta(AskRequest request) => new(request.Options.Select(o => (JsonNode?)o.ToJson()).ToArray());

    private static int Step(CanvasElement element) => element.Meta["step"] is JsonValue v && v.TryGetValue(out int step) ? step : 0;

    /// <summary>Adds the `question` element for a caller-chosen id; returns the element id.</summary>
    public static string OpenQuestion(Workspace ws, AskRequest request, string questionId, JsonObject? extraMeta = null)
    {
        var response = Commit(ws, doc =>
        {
            var meta = new JsonObject
            {
                ["question_id"] = questionId, ["session_id"] = request.SessionId, ["step"] = NextStep(doc, request.SessionId),
                ["total"] = request.Total, ["kind"] = request.Kind, ["state"] = "open", ["answer"] = null, ["option_id"] = null,
                ["allow_custom"] = request.AllowCustom, ["allow_skip"] = request.AllowSkip, ["agent_id"] = request.AgentId,
                ["options"] = OptionsMeta(request),
            };
            foreach (var (key, value) in extraMeta ?? []) meta[key] = value?.DeepClone();
            return [new JsonObject { ["op"] = "add_element", ["temp_id"] = "q", ["render"] = "question", ["layer"] = "questions", ["label"] = request.Question, ["meta"] = meta }];
        });
        return Json.Str(response["id_map"]!["q"])!;
    }

    /// <summary>The `question` element carrying this id, or null.</summary>
    public static CanvasElement? FindElement(Workspace ws, string questionId) =>
        Load(ws).Elements.Values.FirstOrDefault(e => e.Render == "question" && Json.Str(e.Meta["question_id"]) == questionId);

    /// <summary>Every `question` element, in canvas insertion order.</summary>
    public static List<CanvasElement> ListQuestions(Workspace ws) => Load(ws).Elements.Values.Where(e => e.Render == "question").ToList();

    /// <summary>Writes the answered/skipped state onto the element's meta.</summary>
    public static void Settle(Workspace ws, string elementId, string state, QuestionResult result) =>
        Commit(ws, _ => [Update(elementId, new JsonObject { ["state"] = state, ["answer"] = result.Answer, ["option_id"] = result.OptionId })]);

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
        ops.Add(Update(element.Id, new JsonObject { ["state"] = "open", ["answer"] = null, ["option_id"] = null }));
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
            ["options"] = OptionsMeta(request), ["kind"] = request.Kind, ["diagram_requested"] = false,
            ["allow_custom"] = request.AllowCustom, ["allow_skip"] = request.AllowSkip,
            ["session_id"] = request.SessionId, ["total"] = request.Total, ["degraded"] = false, ["validation"] = null,
        };
        foreach (var (key, value) in extraMeta ?? []) meta[key] = value?.DeepClone();
        var ops = (stale ?? []).Select(old => (JsonNode?)Update(old.Id, new JsonObject { ["state"] = "skipped", ["answer"] = null, ["option_id"] = null })).ToList();
        var update = Update(element.Id, meta);
        update["label"] = request.Question;
        ops.Add(update);
        Commit(ws, _ => ops);
    }

    /// <summary>Records the user's "Add diagram" request on the element's meta.</summary>
    public static void RequestDiagram(Workspace ws, CanvasElement element, string requestedAt)
    {
        var count = element.Meta["diagram_requests"] is JsonValue v && v.TryGetValue(out int n) ? n : 0;
        Commit(ws, _ => [Update(element.Id, new JsonObject { ["diagram_requested"] = true, ["diagram_requested_at"] = requestedAt, ["diagram_requests"] = count + 1 })]);
    }

    private static JsonObject Update(string id, JsonObject meta) => new() { ["op"] = "update_element", ["id"] = id, ["meta"] = meta };

    private static int NextBand(CanvasDoc doc)
    {
        var bands = doc.Elements.Values.Where(e => Json.Truthy(e.Meta["diagram_root"])).Select(e => (int)Math.Floor(e.Position.Y / QuestionDiagrams.BandH)).ToList();
        return bands.Count == 0 ? 0 : bands.Max() + 1;
    }

    /// <summary>Draws one option diagram on the `decisions` layer and returns its root id (the ref); nothing is drawn if the option is unknown.</summary>
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
            var result = ApplyBatch.Apply(doc, QuestionDiagrams.Ops(title, nodes, edges, NextBand(doc), optionId), "default", Explanation);
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
