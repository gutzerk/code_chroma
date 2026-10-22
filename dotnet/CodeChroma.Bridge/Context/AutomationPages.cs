using System.Text.RegularExpressions;

namespace CodeChroma.Bridge.Context;

/// <summary>CI workflows and shell scripts as context pages: wiki-general clusters only code, so a release flow would otherwise be invisible to the selector.</summary>
public static partial class AutomationPages
{
    public const string ContainerId = "ci-automation";
    public const int MaxFiles = 60;
    private const int MaxFileBytes = 200_000;
    private const int MaxTitle = 400;

    private static readonly HashSet<string> SkippedDirs = new(StringComparer.Ordinal)
    {
        ".git", "node_modules", ".venv", "venv", "dist", "build", "bin", "obj", "vendor", "target", ".claude", ".codechroma", "__pycache__",
    };

    private static readonly string[] ScriptExtensions = [".sh", ".bash", ".ps1", ".cmd", ".bat"];

    [GeneratedRegex(@"^name:\s*['""]?(.+?)['""]?\s*$")]
    private static partial Regex WorkflowName();

    [GeneratedRegex(@"^  ([A-Za-z0-9_-]+):\s*(#.*)?$")]
    private static partial Regex JobLine();

    [GeneratedRegex(@"^(?:function\s+)?([A-Za-z_][A-Za-z0-9_-]*)\s*\(\)\s*\{?\s*$|^function\s+([A-Za-z_][A-Za-z0-9_-]*)\b")]
    private static partial Regex FunctionLine();

    [GeneratedRegex(@"^(?:on|'on'|""on""):\s*(.*)$")]
    private static partial Regex OnLine();

    /// <summary>Whether a repo-relative path is a CI workflow or a shell/batch script worth describing.</summary>
    public static bool IsAutomationFile(string relative)
    {
        var normalized = relative.Replace('\\', '/');
        var name = Path.GetFileName(normalized);
        if (normalized.StartsWith(".github/workflows/", StringComparison.Ordinal) && (name.EndsWith(".yml") || name.EndsWith(".yaml"))) return true;
        if (name.StartsWith("Dockerfile", StringComparison.Ordinal) || name == "Makefile") return true;
        return ScriptExtensions.Any(extension => name.EndsWith(extension, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Repo-relative automation files in a stable order, capped at <see cref="MaxFiles"/>.</summary>
    public static List<string> Discover(string repoRoot)
    {
        var found = new List<string>();
        var pending = new Stack<string>();
        pending.Push(repoRoot);
        while (pending.Count > 0 && found.Count < MaxFiles * 4)
        {
            var directory = pending.Pop();
            IEnumerable<string> entries;
            try { entries = Directory.EnumerateFileSystemEntries(directory).ToList(); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { continue; }
            foreach (var entry in entries)
            {
                var name = Path.GetFileName(entry);
                if (Directory.Exists(entry))
                {
                    if (!SkippedDirs.Contains(name)) pending.Push(entry);
                    continue;
                }
                var relative = Path.GetRelativePath(repoRoot, entry).Replace('\\', '/');
                if (IsAutomationFile(relative)) found.Add(relative);
            }
        }
        return [.. found.Order(StringComparer.Ordinal).Take(MaxFiles)];
    }

    /// <summary>Changes whenever an automation file is added, removed or edited, so the cache rebuilds.</summary>
    public static string Signature(string repoRoot)
    {
        var parts = new List<string>();
        foreach (var relative in Discover(repoRoot))
        {
            try
            {
                var info = new FileInfo(Path.Combine(repoRoot, relative));
                parts.Add($"{relative}:{info.Length}:{info.LastWriteTimeUtc.Ticks}");
            }
            catch (IOException) { parts.Add(relative); }
        }
        return string.Join('|', parts);
    }

    public static ContainerInfo Container() => new(ContainerId, "CI and automation", "GitHub workflows, shell scripts and build files", "Not clustered into components: read the file itself, there are no code-level node ids.");

    /// <summary>One page per automation file; a page with no readable text is skipped.</summary>
    public static List<PageInfo> Pages(string repoRoot)
    {
        var pages = new List<PageInfo>();
        var usedIds = new HashSet<string>();
        foreach (var relative in Discover(repoRoot))
        {
            if (Describe(repoRoot, relative) is not { } page) continue;
            var id = Skills.WikiGeneralNaming.DedupeId("ci-" + Skills.WikiGeneralNaming.Slugify(relative), usedIds);
            usedIds.Add(id);
            pages.Add(page with { Id = id });
        }
        return pages;
    }

    private static PageInfo? Describe(string repoRoot, string relative)
    {
        string[] lines;
        try
        {
            var path = Path.Combine(repoRoot, relative);
            if (new FileInfo(path).Length > MaxFileBytes) return null;
            lines = File.ReadAllLines(path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return null; }
        var isWorkflow = relative.StartsWith(".github/workflows/", StringComparison.Ordinal);
        var (summary, symbols) = isWorkflow ? DescribeWorkflow(lines) : DescribeScript(lines);
        var fileName = Path.GetFileName(relative);
        var kind = isWorkflow ? "CI workflow" : "script";
        var title = Cut($"{kind} {fileName}: {summary}", MaxTitle);
        var description = $"{kind} at {relative}. It has no code-level node ids: reference it by path.";
        var entry = new FileEntry(relative, symbols);
        return new PageInfo("", fileName, ContainerId, title, description, [entry], []);
    }

    private static (string Summary, List<SymbolLine> Symbols) DescribeWorkflow(string[] lines)
    {
        string? name = null;
        var triggers = new List<string>();
        var jobs = new List<(string Id, int Start)>();
        var section = "";
        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i];
            if (line.Length > 0 && !char.IsWhiteSpace(line[0]) && line[0] != '#') section = line.Split(':')[0].Trim().Trim('\'', '"');
            if (name is null && WorkflowName().Match(line) is { Success: true } n) name = n.Groups[1].Value;
            if (OnLine().Match(line) is { Success: true } on && on.Groups[1].Value.Trim().Trim('[', ']') is { Length: > 0 } inline && !inline.StartsWith('#'))
                triggers.AddRange(inline.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries).Select(t => t.Split(':')[0]));
            else if (section == "on" && Regex.Match(line, @"^  ([A-Za-z_]+):") is { Success: true } trigger) triggers.Add(trigger.Groups[1].Value);
            else if (section == "jobs" && JobLine().Match(line) is { Success: true } job) jobs.Add((job.Groups[1].Value, i + 1));
        }
        var symbols = jobs.Select((job, index) =>
            new SymbolLine("", $"job {job.Id}", false, job.Start, index + 1 < jobs.Count ? jobs[index + 1].Start - 1 : lines.Length, [])).ToList();
        var summary = $"{name ?? "workflow"}; triggers: {string.Join(", ", triggers.Distinct())}; jobs: {string.Join(", ", jobs.Select(j => j.Id))}";
        return (summary, symbols);
    }

    private static (string Summary, List<SymbolLine> Symbols) DescribeScript(string[] lines)
    {
        var comments = lines.Where(l => l.TrimStart().StartsWith('#') && !l.StartsWith("#!")).Select(l => l.TrimStart('#', ' ').Trim()).Where(l => l.Length > 0).Take(3);
        var functions = new List<(string Name, int Start)>();
        for (var i = 0; i < lines.Length; i++)
            if (FunctionLine().Match(lines[i]) is { Success: true } match)
                functions.Add((match.Groups[1].Success ? match.Groups[1].Value : match.Groups[2].Value, i + 1));
        var symbols = functions.Select((function, index) =>
            new SymbolLine("", $"function {function.Name}", false, function.Start, index + 1 < functions.Count ? functions[index + 1].Start - 1 : lines.Length, [])).ToList();
        var summary = $"{string.Join(" ", comments)}; functions: {string.Join(", ", functions.Select(f => f.Name))}";
        return (summary, symbols);
    }

    private static string Cut(string value, int max) => value.Length <= max ? value : value[..max].TrimEnd() + " …";
}
