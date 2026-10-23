using System.Text.Json;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Agents;

/// <summary>A session's token counts from its last main-thread assistant entry; context = input + cache read + cache creation.</summary>
public sealed record TranscriptUsage(long ContextTokens, long InputTokens, long OutputTokens, long CacheReadTokens, string? Model);

/// <summary>What one pass over a transcript yields: the last main-thread usage and the billed tokens per model.</summary>
public sealed record TranscriptSession(TranscriptUsage? Last, IReadOnlyDictionary<string, TokenCounts> Totals);

/// <summary>Billed token counts: uncached input, output, cache reads and cache writes.</summary>
public sealed record TokenCounts(long Input, long Output, long CacheRead, long CacheWrite)
{
    public static TokenCounts operator +(TokenCounts a, TokenCounts b) =>
        new(a.Input + b.Input, a.Output + b.Output, a.CacheRead + b.CacheRead, a.CacheWrite + b.CacheWrite);
}

/// <summary>
/// Finds the Claude Code session id for a worktree, so `claude --resume` continues its chat. The directory name Claude Code
/// derives from a project path is never guessed: every transcript records its own cwd, so the id comes from the newest
/// transcript whose cwd is this worktree, whatever its directory is called.
/// </summary>
public static class Transcripts
{
    public const int MaxScannedTranscripts = 500;
    public const int HeadLines = 12;
    public const string SyntheticModel = "<synthetic>";

    /// <summary>$CLAUDE_CONFIG_DIR/projects, else ~/.claude/projects: the override the CLI honours.</summary>
    public static string ProjectsDir()
    {
        var configured = Environment.GetEnvironmentVariable("CLAUDE_CONFIG_DIR")?.Trim();
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var baseDir = string.IsNullOrEmpty(configured) ? Path.Combine(home, ".claude") : (configured.StartsWith('~') ? home + configured[1..] : configured);
        return Path.Combine(baseDir, "projects");
    }

    /// <summary>The newest transcript's session id for this worktree, skipping ids a sibling already claimed.</summary>
    public static string? FindSessionId(string worktree, string? projectsRoot = null, IReadOnlySet<string>? exclude = null)
    {
        var target = Path.GetFullPath(worktree);
        foreach (var path in NewestFirst(projectsRoot ?? ProjectsDir()))
        {
            var id = SessionIdForCwd(path, target);
            if (id is not null && exclude?.Contains(id) != true) return id;
        }
        return null;
    }

    private static List<string> NewestFirst(string root)
    {
        try
        {
            if (!Directory.Exists(root)) return [];
            return Directory.EnumerateDirectories(root).SelectMany(d => Directory.EnumerateFiles(d, "*.jsonl"))
                .Select(p => (Path: p, Stamp: StampOf(p))).Where(x => x.Stamp is not null)
                .OrderByDescending(x => x.Stamp).Take(MaxScannedTranscripts).Select(x => x.Path).ToList();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return []; }
    }

    private static DateTime? StampOf(string path)
    {
        try { return File.GetLastWriteTimeUtc(path); }
        catch (IOException) { return null; }
    }

    private static string? SessionIdForCwd(string path, string target)
    {
        try
        {
            using var reader = new StreamReader(path);
            for (var index = 0; index < HeadLines; index++)
            {
                var line = reader.ReadLine();
                if (line is null) return null;
                JsonObject? entry;
                try { entry = JsonNode.Parse(line) as JsonObject; }
                catch (JsonException) { continue; }
                if (entry is null || !entry.ContainsKey("cwd")) continue;
                if (!SamePath(entry["cwd"]?.ToString() ?? "", target)) return null;
                return entry["sessionId"] is JsonValue v && v.TryGetValue<string>(out var id) && id.Length > 0 ? id : Path.GetFileNameWithoutExtension(path);
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return null; }
        return null;
    }

    /// <summary>The last main-thread assistant entry's token usage in a session's transcript, or null when it has none.</summary>
    public static TranscriptUsage? ReadUsage(string sessionId, string worktree, string? projectsRoot = null) =>
        ReadSession(sessionId, worktree, projectsRoot)?.Last;

    /// <summary>One streamed pass over a session's transcript: the last main-thread usage and every billed reply's tokens summed per model (a reply streamed as several entries counts its last, final usage); null when there is no transcript.</summary>
    public static TranscriptSession? ReadSession(string sessionId, string worktree, string? projectsRoot = null)
    {
        var path = TranscriptPath(sessionId, worktree, projectsRoot ?? ProjectsDir());
        if (path is null) return null;
        TranscriptUsage? last = null;
        var byMessage = new Dictionary<string, (string Model, TokenCounts Counts)>();
        var lineNumber = 0;
        try
        {
            foreach (var line in File.ReadLines(path))
            {
                lineNumber++;
                if (!line.Contains("\"usage\"", StringComparison.Ordinal)) continue;
                JsonObject? entry;
                try { entry = JsonNode.Parse(line) as JsonObject; }
                catch (JsonException) { continue; }
                if (entry is null || Json.Str(entry["type"]) != "assistant" || entry["message"] is not JsonObject message || message["usage"] is not JsonObject usage) continue;
                var model = Json.Str(message["model"]);
                var counts = new TokenCounts(Count(usage["input_tokens"]), Count(usage["output_tokens"]), Count(usage["cache_read_input_tokens"]), Count(usage["cache_creation_input_tokens"]));
                var sidechain = entry["isSidechain"] is JsonValue side && side.TryGetValue<bool>(out var isSide) && isSide;
                if (model != SyntheticModel && !sidechain)
                    last = new TranscriptUsage(counts.Input + counts.CacheRead + counts.CacheWrite, counts.Input, counts.Output, counts.CacheRead, model);
                if (counts.Input + counts.Output + counts.CacheRead + counts.CacheWrite == 0) continue;
                byMessage[Json.Str(message["id"]) ?? $"#{lineNumber}"] = (model ?? "", counts);
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return null; }
        var totals = new Dictionary<string, TokenCounts>();
        foreach (var (model, counts) in byMessage.Values)
            totals[model] = totals.TryGetValue(model, out var sum) ? sum + counts : counts;
        return new TranscriptSession(last, totals);
    }

    private static string? TranscriptPath(string sessionId, string worktree, string root)
    {
        if (sessionId.Length == 0 || sessionId.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) return null;
        List<string> candidates;
        try
        {
            if (!Directory.Exists(root)) return null;
            candidates = Directory.EnumerateDirectories(root).Select(d => Path.Combine(d, sessionId + ".jsonl")).Where(File.Exists).ToList();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return null; }
        var target = Path.GetFullPath(worktree);
        return candidates.Count > 1 ? candidates.FirstOrDefault(p => SessionIdForCwd(p, target) is not null) ?? candidates[0] : candidates.FirstOrDefault();
    }

    private static long Count(JsonNode? node) => node is JsonValue v && v.TryGetValue<long>(out var n) ? n : 0;

    private static bool SamePath(string a, string b)
    {
        static string Norm(string p) { try { return Path.GetFullPath(p).TrimEnd('\\', '/'); } catch (ArgumentException) { return p; } }
        return string.Equals(Norm(a), Norm(b), OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);
    }
}
