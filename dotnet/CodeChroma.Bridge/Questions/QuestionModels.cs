using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Questions;

/// <summary>The `ask_user` call broke the contract or its arguments; the message is the tool error the agent reads.</summary>
public sealed class QuestionRejected(string message) : Exception(message);

/// <summary>The canvas rejected or failed to save a question write.</summary>
public sealed class QuestionWriteException(string message) : Exception(message);

/// <summary>The request carried no valid per-workspace token.</summary>
public sealed class QuestionAuthException(string message) : Exception(message);

/// <summary>One answer card; Rank 1 is the agent's recommendation, DiagramRef links a diagram.</summary>
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

    public static QuestionOption FromJson(JsonNode? node, int index)
    {
        if (node is not JsonObject o) throw new QuestionRejected($"options[{index}] must be an object");
        return new QuestionOption
        {
            Id = ArgReader.Required(o, "id", $"options[{index}]"),
            Title = ArgReader.Required(o, "title", $"options[{index}]"),
            Description = ArgReader.Text(o, "description", $"options[{index}]"),
            Pro = ArgReader.Text(o, "pro", $"options[{index}]"),
            Con = ArgReader.Text(o, "con", $"options[{index}]"),
            Rank = ArgReader.OptionalInt(o, "rank", $"options[{index}]"),
            Why = ArgReader.Text(o, "why", $"options[{index}]"),
            DiagramRef = ArgReader.OptionalText(o, "diagram_ref", $"options[{index}]"),
        };
    }
}

/// <summary>The `ask_user` tool input.</summary>
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

    public static AskRequest FromJson(JsonObject o)
    {
        var kind = ArgReader.OptionalText(o, "kind", "ask_user") ?? "choices";
        if (kind is not ("choices" or "diagram")) throw new QuestionRejected("ask_user: kind must be \"choices\" or \"diagram\"");
        var options = new List<QuestionOption>();
        if (o["options"] is { } raw)
        {
            if (raw is not JsonArray array) throw new QuestionRejected("ask_user: options must be an array");
            for (var i = 0; i < array.Count; i++) options.Add(QuestionOption.FromJson(array[i], i));
        }
        return new AskRequest
        {
            Question = ArgReader.Required(o, "question", "ask_user"),
            SessionId = ArgReader.OptionalText(o, "session_id", "ask_user"),
            Kind = kind,
            Options = options,
            AllowCustom = ArgReader.Flag(o, "allow_custom", true),
            AllowSkip = ArgReader.Flag(o, "allow_skip", true),
            Total = ArgReader.OptionalInt(o, "total", "ask_user"),
            AgentId = ArgReader.OptionalText(o, "agent_id", "ask_user"),
            Degraded = ArgReader.Flag(o, "degraded", false),
        };
    }
}

/// <summary>What the waiting agent receives: an answer, a skip, a needs marker, or still-pending.</summary>
public sealed class QuestionResult
{
    public string? Answer { get; init; }
    public string? OptionId { get; init; }
    public bool Skipped { get; init; }
    public bool Pending { get; init; }
    public string? Needs { get; init; }
    public string? QuestionId { get; init; }

    /// <summary>The JSON the tool returns; pending and needs results carry only what the agent needs.</summary>
    public JsonObject ToToolJson()
    {
        if (!string.IsNullOrEmpty(Needs)) return new JsonObject { ["needs"] = Needs, ["question_id"] = QuestionId };
        if (Pending) return new JsonObject { ["pending"] = true, ["question_id"] = QuestionId };
        return new JsonObject { ["answer"] = Answer, ["option_id"] = OptionId, ["skipped"] = Skipped };
    }
}

/// <summary>Strict typed reads of tool arguments (a wrong type is a rejection, not a coercion).</summary>
internal static class ArgReader
{
    public static string Required(JsonObject o, string key, string where) =>
        o[key] is null ? throw new QuestionRejected($"{where}: {key} is required") : Json.Str(o[key]) ?? throw new QuestionRejected($"{where}: {key} must be a string");

    public static string Text(JsonObject o, string key, string where) => OptionalText(o, key, where) ?? "";

    public static string? OptionalText(JsonObject o, string key, string where) =>
        o[key] is null ? null : Json.Str(o[key]) ?? throw new QuestionRejected($"{where}: {key} must be a string");

    public static int? OptionalInt(JsonObject o, string key, string where)
    {
        if (o[key] is not { } node) return null;
        if (node is JsonValue v && v.TryGetValue(out double d) && d == Math.Floor(d) && Math.Abs(d) < int.MaxValue) return (int)d;
        throw new QuestionRejected($"{where}: {key} must be an integer");
    }

    public static bool Flag(JsonObject o, string key, bool fallback) =>
        o[key] is null ? fallback : o[key] is JsonValue v && v.TryGetValue(out bool b) ? b : throw new QuestionRejected($"{key} must be a boolean");
}
