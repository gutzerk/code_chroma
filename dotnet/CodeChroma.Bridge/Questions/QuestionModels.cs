using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Questions;

/// <summary>One answer card; rank 1 is the agent's recommendation, DiagramRef links a diagram root.</summary>
public sealed class QuestionOption
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string Pro { get; set; } = "";
    public string Con { get; set; } = "";
    public int? Rank { get; set; }
    public string Why { get; set; } = "";
    public string? DiagramRef { get; set; }

    public JsonObject ToJson() => new()
    {
        ["id"] = Id, ["title"] = Title, ["description"] = Description, ["pro"] = Pro, ["con"] = Con,
        ["rank"] = Rank, ["why"] = Why, ["diagram_ref"] = DiagramRef,
    };

    /// <summary>Parses one option; id and title are required strings, every other field is optional.</summary>
    public static QuestionOption FromJson(JsonNode? node, int index)
    {
        if (node is not JsonObject o) throw new QuestionRejected($"options[{index}] must be an object");
        if (Json.Str(o["id"]) is not { } id || Json.Str(o["title"]) is not { } title)
            throw new QuestionRejected($"options[{index}]: id and title are required strings");
        return new QuestionOption
        {
            Id = id, Title = title, Description = Json.Str(o["description"]) ?? "", Pro = Json.Str(o["pro"]) ?? "",
            Con = Json.Str(o["con"]) ?? "", Why = Json.Str(o["why"]) ?? "", DiagramRef = Json.Str(o["diagram_ref"]),
            Rank = Json.IntOrNull(o["rank"]),
        };
    }

    /// <summary>The title, or the id for an untitled option.</summary>
    public string DisplayName => Title.Length > 0 ? Title : Id;
}

/// <summary>The ask_user input.</summary>
public sealed class AskRequest
{
    public string Question { get; set; } = "";
    public string? SessionId { get; set; }
    public string Kind { get; set; } = "choices";
    public List<QuestionOption> Options { get; set; } = [];
    public bool AllowCustom { get; set; } = true;
    public bool AllowSkip { get; set; } = true;
    public int? Total { get; set; }
    public string? AgentId { get; set; }
    public bool Degraded { get; set; }

    public JsonArray OptionsJson() => new(Options.Select(o => (JsonNode?)o.ToJson()).ToArray());

    /// <summary>Parses an ask body or tool arguments; a malformed field raises QuestionRejected.</summary>
    public static AskRequest FromJson(JsonObject o)
    {
        if (Json.Str(o["question"]) is not { } question) throw new QuestionRejected("question is required and must be a string");
        var kind = o["kind"] is null ? "choices" : Json.Str(o["kind"]);
        if (kind is not ("choices" or "diagram")) throw new QuestionRejected("kind must be \"choices\" or \"diagram\"");
        var options = new List<QuestionOption>();
        if (o["options"] is JsonArray array) options.AddRange(array.Select((n, i) => QuestionOption.FromJson(n, i)));
        else if (o["options"] is not null) throw new QuestionRejected("options must be an array");
        return new AskRequest
        {
            Question = question, Kind = kind, Options = options, SessionId = Json.Str(o["session_id"]),
            AllowCustom = Json.BoolOr(o["allow_custom"], true),
            AllowSkip = Json.BoolOr(o["allow_skip"], true),
            Total = Json.IntOrNull(o["total"]), AgentId = Json.Str(o["agent_id"]),
            Degraded = Json.Bool(o["degraded"]),
        };
    }
}

/// <summary>What the waiting agent receives: an answer, a skip, a needs marker, or still-pending.</summary>
public sealed record QuestionResult(string? Answer = null, string? OptionId = null, bool Skipped = false, bool Pending = false, string? Needs = null, string? QuestionId = null)
{
    public JsonObject ToToolJson()
    {
        if (Needs is { Length: > 0 }) return new JsonObject { ["needs"] = Needs, ["question_id"] = QuestionId };
        if (Pending) return new JsonObject { ["pending"] = true, ["question_id"] = QuestionId };
        return new JsonObject { ["answer"] = Answer, ["option_id"] = OptionId, ["skipped"] = Skipped };
    }
}
