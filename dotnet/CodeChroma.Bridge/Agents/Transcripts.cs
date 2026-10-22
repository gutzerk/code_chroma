using System.Text.Json;
using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Agents;

/// <summary>A session's token counts from its last main-thread assistant entry; context = input + cache read + cache creation.</summary>
public sealed record TranscriptUsage(long ContextTokens, long InputTokens, long OutputTokens, long CacheReadTokens, string? Model);

/// <summary>
/// Finds the Claude Code session id for a worktree, so `claude --resume` continues its chat. The directory name Claude Code
/// derives from a project path is never guessed: every transcript records its own cwd, so the id comes from the newest
/// transcript whose cwd is this worktree, whatever its directory is called.
/// </summary>
public static class Transcripts
{
    public const int MaxScannedTranscripts = 500;
    public const int HeadLines = 12;

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
    public static TranscriptUsage? ReadUsage(string sessionId, string worktree, string? projectsRoot = null)
    {
        if (sessionId.Length == 0 || sessionId.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) return null;
        var root = projectsRoot ?? ProjectsDir();
        List<string> candidates;
        try
        {
            if (!Directory.Exists(root)) return null;
            candidates = Directory.EnumerateDirectories(root).Select(d => Path.Combine(d, sessionId + ".jsonl")).Where(File.Exists).ToList();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return null; }
        var target = Path.GetFullPath(worktree);
        var path = candidates.Count > 1 ? candidates.FirstOrDefault(p => SessionIdForCwd(p, target) is not null) ?? candidates[0] : candidates.FirstOrDefault();
        return path is null ? null : LastUsage(path);
    }

    private static TranscriptUsage? LastUsage(string path)
    {
        string[] lines;
        try { lines = File.ReadAllLines(path); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return null; }
        for (var i = lines.Length - 1; i >= 0; i--)
        {
            if (!lines[i].Contains("\"usage\"", StringComparison.Ordinal)) continue;
            JsonObject? entry;
            try { entry = JsonNode.Parse(lines[i]) as JsonObject; }
            catch (JsonException) { continue; }
            if (entry is null || Text(entry["type"]) != "assistant" || entry["isSidechain"] is JsonValue side && side.TryGetValue<bool>(out var sidechain) && sidechain) continue;
            if (entry["message"] is not JsonObject message || message["usage"] is not JsonObject usage) continue;
            var input = Count(usage["input_tokens"]);
            var cacheRead = Count(usage["cache_read_input_tokens"]);
            var cacheCreation = Count(usage["cache_creation_input_tokens"]);
            return new TranscriptUsage(input + cacheRead + cacheCreation, input, Count(usage["output_tokens"]), cacheRead, Text(message["model"]));
        }
        return null;
    }

    private static string? Text(JsonNode? node) => node is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    private static long Count(JsonNode? node) => node is JsonValue v && v.TryGetValue<long>(out var n) ? n : 0;

    private static bool SamePath(string a, string b)
    {
        static string Norm(string p) { try { return Path.GetFullPath(p).TrimEnd('\\', '/'); } catch (ArgumentException) { return p; } }
        return string.Equals(Norm(a), Norm(b), OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);
    }
}
