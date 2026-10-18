using System.Text.Json;
using System.Text.Json.Nodes;

namespace CodeChroma.Bridge.Agents;

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

    private static bool SamePath(string a, string b)
    {
        static string Norm(string p) { try { return Path.GetFullPath(p).TrimEnd('\\', '/'); } catch (ArgumentException) { return p; } }
        return string.Equals(Norm(a), Norm(b), OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal);
    }
}
