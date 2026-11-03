using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Agents;

/// <summary>One prompt the user typed in a claude session, with the file edits and command runs of the reply that followed it.</summary>
public sealed record AgentPrompt(string Id, string Text, string? CreatedAt, int Edits, int Runs);

/// <summary>The prompt navigator's list: the user's own prompts in a claude session's transcript, in order.</summary>
public static partial class AgentPrompts
{
    private static readonly HashSet<string> EditTools = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
    private const string RunTool = "Bash";

    /// <summary>Each transcript's last parse, reused while the file's length and write time are unchanged (the route is polled).</summary>
    private static readonly ConcurrentDictionary<string, (long Length, DateTime Written, IReadOnlyList<AgentPrompt> Prompts)> Parsed = new();

    /// <summary>The route payload: `{"prompts": [...]}`, empty for a non-claude agent or one with no session yet; `sessionOf` runs only for a claude agent.</summary>
    public static JsonObject Read(AgentRecord record, Func<string?> sessionOf, string? projectsRoot = null)
    {
        var sessionId = record.Kind == AgentRecord.DefaultKind ? sessionOf() : null;
        var prompts = string.IsNullOrEmpty(sessionId) ? [] : ReadSession(sessionId, record.Worktree, projectsRoot);
        return new JsonObject { ["prompts"] = new JsonArray(prompts.Select(Payload).ToArray<JsonNode?>()) };
    }

    /// <summary>Every main-thread user prompt in a session's transcript; tool results, meta entries and command output are skipped.</summary>
    public static IReadOnlyList<AgentPrompt> ReadSession(string sessionId, string worktree, string? projectsRoot = null)
    {
        if (Transcripts.Locate(sessionId, worktree, projectsRoot) is not { } path) return [];
        FileInfo file;
        try { file = new FileInfo(path); _ = file.Length; }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return []; }
        if (Parsed.TryGetValue(path, out var hit) && hit.Length == file.Length && hit.Written == file.LastWriteTimeUtc) return hit.Prompts;
        var prompts = Parse(path);
        if (prompts is null) return [];
        Parsed[path] = (file.Length, file.LastWriteTimeUtc, prompts);
        return prompts;
    }

    private static List<AgentPrompt>? Parse(string path)
    {
        var prompts = new List<AgentPrompt>();
        var seenTools = new HashSet<string>();
        var read = Transcripts.ForEachEntry(path, IsCandidate, (entry, _) =>
        {
            if (Json.Bool(entry["isSidechain"]) || entry["message"] is not JsonObject message) return;
            var type = Json.Str(entry["type"]);
            if (type == "user" && !Json.Bool(entry["isMeta"]) && !Json.Bool(entry["isCompactSummary"]) && PromptText(message["content"]) is { } text)
                prompts.Add(new AgentPrompt(Json.Str(entry["uuid"]) ?? $"p{prompts.Count + 1}", text, Json.Str(entry["timestamp"]), 0, 0));
            else if (type == "assistant" && prompts.Count > 0 && message["content"] is JsonArray blocks)
                prompts[^1] = Count(prompts[^1], blocks, seenTools);
        });
        return read ? prompts : null;
    }

    private static bool IsCandidate(string line) =>
        line.Contains("\"user\"", StringComparison.Ordinal) || line.Contains("\"tool_use\"", StringComparison.Ordinal);

    /// <summary>What the user typed, or null for a tool result, interrupt marker or command output; a slash command reads as `/name args`, other text starting with `<` is kept.</summary>
    public static string? PromptText(JsonNode? content)
    {
        string text;
        if (content is JsonValue value && value.TryGetValue<string>(out var plain)) text = plain;
        else if (content is JsonArray items)
        {
            if (items.Any(i => Json.Str(i?["type"]) == "tool_result")) return null;
            text = string.Join("\n", items.Where(i => Json.Str(i?["type"]) == "text").Select(i => Json.Str(i?["text"]) ?? ""));
        }
        else return null;
        text = text.Trim();
        if (text.Length == 0 || text.StartsWith("[Request interrupted", StringComparison.Ordinal)) return null;
        if (!text.StartsWith('<')) return text;
        if (CommandName().Match(text) is { Success: true } command)
        {
            var args = CommandArgs().Match(text) is { Success: true } a ? a.Groups[1].Value.Trim() : "";
            return $"{command.Groups[1].Value.Trim()} {args}".TrimEnd();
        }
        if (BashInput().Match(text) is { Success: true } bash) return "!" + bash.Groups[1].Value.Trim();
        return OutputTag().IsMatch(text) ? null : text;
    }

    private static AgentPrompt Count(AgentPrompt prompt, JsonArray blocks, HashSet<string> seen)
    {
        var (edits, runs) = (prompt.Edits, prompt.Runs);
        foreach (var block in blocks)
        {
            if (Json.Str(block?["type"]) != "tool_use") continue;
            if (Json.Str(block?["id"]) is { } id && !seen.Add(id)) continue;
            var name = Json.Str(block?["name"]) ?? "";
            if (EditTools.Contains(name)) edits++;
            else if (name == RunTool) runs++;
        }
        return prompt with { Edits = edits, Runs = runs };
    }

    private static JsonObject Payload(AgentPrompt p) => new()
    {
        ["id"] = p.Id, ["text"] = p.Text, ["createdAt"] = p.CreatedAt, ["edits"] = p.Edits, ["runs"] = p.Runs,
    };

    [GeneratedRegex("<command-name>(.*?)</command-name>", RegexOptions.Singleline)]
    private static partial Regex CommandName();

    [GeneratedRegex("<command-args>(.*?)</command-args>", RegexOptions.Singleline)]
    private static partial Regex CommandArgs();

    [GeneratedRegex("^<bash-input>(.*?)</bash-input>", RegexOptions.Singleline)]
    private static partial Regex BashInput();

    [GeneratedRegex("^<(local-command-std(out|err)|bash-std(out|err)|local-command-caveat|system-reminder|task-notification|user-prompt-submit-hook)>")]
    private static partial Regex OutputTag();
}
