using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Questions;

/// <summary>Types a settled answer into the asking agent's terminal as its next message.</summary>
public static class QuestionDelivery
{
    public const int IdleAttempts = 86400;
    public const string Skipped = "skipped by the user, decide yourself";
    public const string DiagramRequest = "the user wants a diagram for each option: draw them with draw_option_diagram, then call ask_user again with the same session_id and question";

    /// <summary>Control characters would be keystrokes in the PTY, so they collapse into single spaces.</summary>
    private static string OneLine(string? value)
    {
        var spaced = (value ?? "").Select(c => char.IsControl(c) || char.IsWhiteSpace(c) ? ' ' : c).ToArray();
        return string.Join(' ', new string(spaced).Split(' ', StringSplitOptions.RemoveEmptyEntries));
    }

    private static string Header(string kind, CanvasElement element)
    {
        var step = element.Meta["step"] is JsonValue s && s.TryGetValue(out int stepNumber) && stepNumber != 0 ? stepNumber : 1;
        var total = element.Meta["total"] is JsonValue t && t.TryGetValue(out int totalNumber) && totalNumber != 0 ? $"/{totalNumber}" : "";
        return $"[CodeChroma {kind} · Q{step}{total} · {Json.Str(element.Meta["question_id"])}]";
    }

    /// <summary>The line typed into the agent for a settled question: answer, skip or a changed answer after a revise.</summary>
    public static string AnswerMessage(CanvasElement element)
    {
        var answer = Json.Str(element.Meta["answer"]);
        var outcome = Json.Str(element.Meta["state"]) == "skipped" ? Skipped
            : Json.Truthy(element.Meta["revised"]) ? "changed answer: " + answer
            : answer;
        return OneLine($"{Header("answer", element)} {element.Label} → {outcome}");
    }

    /// <summary>The line typed into the agent when the user presses "Add diagram".</summary>
    public static string DiagramRequestMessage(CanvasElement element) =>
        OneLine($"{Header("request", element)} {element.Label} → {DiagramRequest}");

    /// <summary>Queues the text for the agent that asked; true when a live session will receive it.</summary>
    public static bool Deliver(AgentSessionRegistry sessions, CanvasElement element, string text) =>
        Deliver(Json.Str(element.Meta["agent_id"]), id => sessions.Get(id) is { IsAlive: true } s ? t => s.InjectWhenIdle(t, IdleAttempts) : null, text);

    /// <summary>The seam under Deliver: `injector` returns the live session's inject call, or null.</summary>
    public static bool Deliver(string? agentId, Func<string, Func<string, Task>?> injector, string text)
    {
        if (string.IsNullOrEmpty(agentId) || injector(agentId) is not { } inject) return false;
        _ = inject(text);
        return true;
    }
}
