using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Questions;

/// <summary>Types the settled answers into the asking agent's terminal as its next message, once per completed batch.</summary>
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

    /// <summary>Every settled answer of one batch as one line, in the order the agent asked them.</summary>
    public static string BatchMessage(IEnumerable<CanvasElement> batch) => string.Join(' ', batch.Select(AnswerMessage));

    private static Func<string, Func<Func<string?>, Task<bool>>?> Injector(AgentSessionRegistry sessions) =>
        id => sessions.Get(id) is { IsAlive: true } s ? t => s.InjectWhenIdle(t, IdleAttempts) : null;

    /// <summary>Queues the text for the agent that asked; true when a live session will receive it.</summary>
    public static bool Deliver(AgentSessionRegistry sessions, CanvasElement element, string text) =>
        Deliver(Json.Str(element.Meta["agent_id"]), id => Injector(sessions)(id) is { } inject ? t => inject(() => t) : null, text);

    /// <summary>After a settle: once the agent has no open question left, queues one wake-up with its answers; true when a live session will get it.</summary>
    public static bool DeliverSettled(AgentSessionRegistry sessions, Workspace ws, CanvasElement settled) => DeliverSettled(ws, settled, Injector(sessions));

    /// <summary>The seam under DeliverSettled; without a live session nothing is removed, so ask_user_result can still read the answer.</summary>
    public static bool DeliverSettled(Workspace ws, CanvasElement settled, Func<string, Func<Func<string?>, Task<bool>>?> injector)
    {
        var agentId = Json.Str(settled.Meta["agent_id"]);
        if (string.IsNullOrEmpty(agentId) || injector(agentId) is not { } inject) return false;
        if (QuestionStore.ClaimBatch(ws, agentId)) _ = TypeBatch(ws, agentId, inject);
        return true;
    }

    /// <summary>Types the batch as it stands when the agent idles, clears what was typed, then unclaims; never throws.</summary>
    private static async Task TypeBatch(Workspace ws, string agentId, Func<Func<string?>, Task<bool>> inject)
    {
        List<CanvasElement> typed = [];
        try
        {
            var sent = await inject(() =>
            {
                typed = QuestionStore.PendingBatch(ws, agentId);
                return typed.Count > 0 ? BatchMessage(typed) : null;
            });
            if (sent && typed.Count > 0) QuestionStore.ClearBatch(ws, typed);
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"questions: could not deliver the answers of agent {agentId}: {error.Message}");
        }
        finally
        {
            QuestionStore.ReleaseBatch(ws, agentId);
        }
    }

    /// <summary>The seam under Deliver: `injector` returns the live session's inject call, or null.</summary>
    public static bool Deliver(string? agentId, Func<string, Func<string, Task>?> injector, string text)
    {
        if (string.IsNullOrEmpty(agentId) || injector(agentId) is not { } inject) return false;
        _ = inject(text);
        return true;
    }
}
