using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Agents;

/// <summary>What a claude session says it is about: its /rename name, Claude Code's own generated title, and the first prompt the user typed.</summary>
public sealed record SessionTopic(string? Custom, string? AiTitle, string? Opening);

/// <summary>
/// Names an agent after what it works on, the way herdr-auto-title does: no model call of our own, but the `custom-title`
/// (/rename) and `ai-title` entries Claude Code writes into its transcript, then a short heuristic title from the first prompt.
/// A title the user set by hand (TitleSource "user") is never replaced.
/// </summary>
public static partial class AutoTitle
{
    public const string DefaultSource = "default";
    public const string AutoSource = "auto";
    public const string UserSource = "user";
    public static readonly string[] Sources = [DefaultSource, AutoSource, UserSource];

    /// <summary>The events-socket message carrying a renamed agent's title, so its row and window update in place.</summary>
    public const string TitleEvent = "agent-title";

    /// <summary>The longest title kept from the session; longer ones are cut at a word with an ellipsis.</summary>
    public const int MaxChars = 60;

    /// <summary>The longest title a hand rename may set.</summary>
    public const int MaxUserChars = 120;

    /// <summary>A heuristic title keeps at most this many words of the first prompt, within HeuristicChars.</summary>
    public const int HeuristicWords = 6;
    public const int HeuristicChars = 48;

    /// <summary>A transcript line longer than this (a pasted image, a huge tool result) is skipped, never buffered whole.</summary>
    public const int MaxLineBytes = 1024 * 1024;

    /// <summary>At most this many transcripts are followed; past it the cache starts over (a later refresh rereads from the start).</summary>
    public const int MaxFollowed = 256;

    private const string Ellipsis = "…";

    /// <summary>Per transcript: how far it was read and the topic read so far, so each refresh reads only the appended bytes.</summary>
    private static readonly ConcurrentDictionary<string, (long Offset, SessionTopic Topic)> Followed = new();

    /// <summary>The hook reports that refresh the title: a submitted prompt, and the end of a turn, by when Claude Code has written its ai-title.</summary>
    public static bool Triggers(JsonObject report) => Json.Str(report["hook_event_name"]) is "UserPromptSubmit" or "Stop";

    public static string CoerceSource(string? value) => value is not null && Sources.Contains(value) ? value : DefaultSource;

    /// <summary>The title the agent's session suggests, or null when it suggests none yet; the hook's `transcriptPath` saves locating the transcript by session id.</summary>
    public static string? Suggest(AgentRecord record, Func<string?> sessionOf, string? projectsRoot = null, string? transcriptPath = null)
    {
        if (!record.HasClaudeSession) return null;
        var root = projectsRoot ?? Transcripts.ProjectsDir();
        var path = IsTranscript(transcriptPath, root) ? transcriptPath : sessionOf() is { Length: > 0 } sessionId ? Transcripts.Locate(sessionId, record.Worktree, root) : null;
        return Choose(path is null ? null : Read(path, wantsOpening: record.ContextKind != "task"), record);
    }

    /// <summary>True only for a plain `.jsonl` file under the claude projects root: a hook report's path is never trusted to name any other file.</summary>
    public static bool IsTranscript(string? path, string projectsRoot)
    {
        if (string.IsNullOrEmpty(path) || !path.EndsWith(".jsonl", StringComparison.Ordinal)) return false;
        var full = Path.GetFullPath(path);
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(projectsRoot)) + Path.DirectorySeparatorChar;
        if (!full.StartsWith(root, OperatingSystem.IsLinux() ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase)) return false;
        var file = new FileInfo(full);
        return file.Exists && file.LinkTarget is null;
    }

    /// <summary>The /rename name, else Claude's generated title, else a heuristic from the user's own words; a task agent's first prompt is the composed skill text, so it falls back to its request only.</summary>
    public static string? Choose(SessionTopic? topic, AgentRecord record)
    {
        if (Shorten(topic?.Custom, MaxChars) is { } custom) return custom;
        if (Shorten(topic?.AiTitle, MaxChars) is { } generated) return generated;
        var words = record.ContextKind == "task" ? record.DiagramRequest ?? record.WorkflowRequest : topic?.Opening;
        return Heuristic(words);
    }

    /// <summary>A few words of a prompt's first line: links shortened to their last path segment, at most HeuristicWords words and HeuristicChars chars, first letter capitalised.</summary>
    public static string? Heuristic(string? prompt)
    {
        var line = prompt?.Split('\n').Select(l => l.Trim()).FirstOrDefault(l => l.Length > 0);
        if (line is null) return null;
        var words = Url().Replace(line, m => LastSegment(m.Value)).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        var kept = string.Join(' ', words.Take(HeuristicWords));
        if (words.Length > HeuristicWords) kept = TrimTail(kept) + Ellipsis;
        if (Shorten(kept, HeuristicChars) is not { } shortened) return null;
        return char.ToUpper(shortened[0], CultureInfo.InvariantCulture) + shortened[1..];
    }

    /// <summary>One clean line of at most `limit` chars, cut at a word with an ellipsis when longer; null when nothing is left.</summary>
    public static string? Shorten(string? text, int limit)
    {
        var clean = AgentRecord.CleanContext(text);
        if (clean is null) return null;
        if (clean.Length <= limit) return clean;
        var head = clean[..(limit - Ellipsis.Length)];
        var space = head.LastIndexOf(' ');
        if (space > limit / 2) head = head[..space];
        return TrimTail(head) + Ellipsis;
    }

    private static string TrimTail(string text) => text.TrimEnd(' ', ',', ';', ':', '.', '-', '—', '–');

    private static string LastSegment(string url)
    {
        var path = url.Split('?', '#')[0].TrimEnd('/');
        var segment = path[(path.LastIndexOf('/') + 1)..];
        return segment.Length > 0 && !segment.Contains(':') ? segment : url;
    }

    /// <summary>The topic of one transcript, reading only the lines appended since the last call (streamed, never the whole file at once); a shorter file was rewritten, so it is read again from the start.</summary>
    public static SessionTopic Read(string path, bool wantsOpening = true)
    {
        var (offset, topic) = Followed.TryGetValue(path, out var held) ? held : (0L, new SessionTopic(null, null, null));
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (stream.Length < offset) (offset, topic) = (0L, new SessionTopic(null, null, null));
            stream.Seek(offset, SeekOrigin.Begin);
            var chunk = new byte[64 * 1024];
            using var line = new MemoryStream();
            long lineBytes = 0;
            void Append(int start, int count)
            {
                lineBytes += count;
                if (lineBytes <= MaxLineBytes) line.Write(chunk, start, count);
                else line.SetLength(0);
            }
            int read;
            while ((read = stream.Read(chunk)) > 0)
            {
                var start = 0;
                for (var i = Array.IndexOf(chunk, (byte)'\n', 0, read); i >= 0; i = Array.IndexOf(chunk, (byte)'\n', start, read - start))
                {
                    Append(start, i - start);
                    if (lineBytes <= MaxLineBytes) topic = Absorb(topic, Encoding.UTF8.GetString(line.GetBuffer(), 0, (int)line.Length), wantsOpening);
                    offset += lineBytes + 1;
                    line.SetLength(0);
                    lineBytes = 0;
                    start = i + 1;
                }
                Append(start, read - start);
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return topic; }
        if (Followed.Count >= MaxFollowed && !Followed.ContainsKey(path)) Followed.Clear();
        Followed[path] = (offset, topic);
        return topic;
    }

    /// <summary>One transcript line: the last name of each kind wins, the first opening stays (looked for only when `wantsOpening`; tool results are never one).</summary>
    public static SessionTopic Absorb(SessionTopic topic, string line, bool wantsOpening = true)
    {
        var titled = line.Contains("-title\"", StringComparison.Ordinal);
        var opening = wantsOpening && topic.Opening is null && line.Contains("\"user\"", StringComparison.Ordinal) && !line.Contains("\"tool_result\"", StringComparison.Ordinal);
        if (!titled && !opening) return topic;
        JsonObject? entry;
        try { entry = JsonNode.Parse(line) as JsonObject; }
        catch (JsonException) { return topic; }
        if (entry is null) return topic;
        var type = Json.Str(entry["type"]);
        if (type == "custom-title" && Json.Str(entry["customTitle"]) is { Length: > 0 } custom) return topic with { Custom = custom };
        if (type == "ai-title" && Json.Str(entry["aiTitle"]) is { Length: > 0 } generated) return topic with { AiTitle = generated };
        if (!opening || AgentPrompts.UserPrompt(entry) is not { } text || IsInjected(text)) return topic;
        return topic with { Opening = text };
    }

    /// <summary>Text the bridge typed into the session (launch context, question answers), not the user's words.</summary>
    private static bool IsInjected(string text) =>
        text.StartsWith(Routes.AgentRoutes.ContextPrefix, StringComparison.Ordinal) || text.StartsWith(Questions.QuestionDelivery.HeaderPrefix, StringComparison.Ordinal);

    [GeneratedRegex(@"https?://\S+")]
    private static partial Regex Url();
}
