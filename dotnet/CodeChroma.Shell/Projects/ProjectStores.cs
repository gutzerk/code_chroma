using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace CodeChroma.Shell;

public sealed record RecentRepo(string Path, string Name, long OpenedAt, bool Missing = false);

public static class RecentRepos
{
    public const int MaxRecents = 10;

    public static string StorePath(string userDataDir) => System.IO.Path.Combine(userDataDir, "recent.json");

    public static IReadOnlyList<RecentRepo> Read(string storePath) =>
        [.. ReadStored(storePath).Select(e => e with { Missing = !Directory.Exists(e.Path) && !File.Exists(e.Path) })];

    public static IReadOnlyList<RecentRepo> Add(string storePath, string repoPath, long now)
    {
        var entry = new RecentRepo(repoPath, Basename(repoPath), now);
        var next = new[] { entry }.Concat(ReadStored(storePath).Where(e => e.Path != repoPath)).Take(MaxRecents).ToList();
        Write(storePath, next);
        return Read(storePath);
    }

    public static IReadOnlyList<RecentRepo> Remove(string storePath, string repoPath)
    {
        Write(storePath, ReadStored(storePath).Where(e => e.Path != repoPath).ToList());
        return Read(storePath);
    }

    private static List<RecentRepo> ReadStored(string storePath)
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(storePath));
            if (doc.RootElement.ValueKind != JsonValueKind.Array) return [];
            var result = new List<RecentRepo>();
            foreach (var item in doc.RootElement.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object) continue;
                if (!item.TryGetProperty("path", out var path) || path.ValueKind != JsonValueKind.String || !System.IO.Path.IsPathRooted(path.GetString())) continue;
                if (!item.TryGetProperty("name", out var name) || name.ValueKind != JsonValueKind.String) continue;
                if (!item.TryGetProperty("openedAt", out var opened) || !opened.TryGetInt64(out var at)) continue;
                result.Add(new RecentRepo(path.GetString()!, name.GetString()!, at));
            }
            return result;
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return [];
        }
    }

    private static void Write(string storePath, List<RecentRepo> entries)
    {
        Directory.CreateDirectory(System.IO.Path.GetDirectoryName(storePath)!);
        var shaped = entries.Select(e => new { path = e.Path, name = e.Name, openedAt = e.OpenedAt });
        File.WriteAllText(storePath, JsonSerializer.Serialize(shaped, new JsonSerializerOptions { WriteIndented = true }));
    }

    private static string Basename(string repoPath)
    {
        var segments = repoPath.Split(['/', '\\'], StringSplitOptions.RemoveEmptyEntries);
        return segments.Length == 0 ? repoPath : string.Join("/", segments.TakeLast(2));
    }
}

public sealed record WorkspaceSummary(string Id, string Label);

public static class WorkspaceSummaries
{
    public static IReadOnlyList<WorkspaceSummary> ForRepo(string repoPath)
    {
        var agents = Items(repoPath, "agents.json")
            .Where(e => Str(e, "id") is not null && Str(e, "title") is not null)
            .Select(e => new WorkspaceSummary(Str(e, "id")!, Str(e, "title")!));
        var prs = Items(repoPath, "prs.json")
            .Where(e => e.TryGetProperty("number", out var n) && n.ValueKind == JsonValueKind.Number)
            .Select(e =>
            {
                var number = e.GetProperty("number").GetRawText();
                var title = Str(e, "title");
                return new WorkspaceSummary($"pr-{number}", string.IsNullOrEmpty(title) ? $"PR #{number}" : $"PR #{number}: {title}");
            });
        return [.. agents, .. prs];
    }

    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static List<JsonElement> Items(string repoPath, string file)
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(repoPath, ".codechroma", file)));
            return doc.RootElement.ValueKind == JsonValueKind.Array
                ? [.. doc.RootElement.EnumerateArray().Where(e => e.ValueKind == JsonValueKind.Object).Select(e => e.Clone())]
                : [];
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException)
        {
            return [];
        }
    }
}

public static partial class NewProject
{
    [GeneratedRegex("[\\\\/:*?\"<>|\\u0000-\\u001f]")]
    private static partial Regex InvalidChars();

    public static string? Validate(string name)
    {
        var trimmed = name.Trim();
        if (trimmed.Length == 0) return "Enter a project name.";
        if (trimmed is "." or ".." || trimmed.EndsWith('.')) return "Invalid project name.";
        if (InvalidChars().IsMatch(trimmed)) return "The name can't contain \\ / : * ? \" < > |.";
        return null;
    }

    public static string Create(string parentDir, string name, Action<string>? gitInit = null)
    {
        if (Validate(name) is { } problem) throw new InvalidOperationException(problem);
        if (!Directory.Exists(parentDir)) throw new InvalidOperationException($"Directory does not exist: {parentDir}");
        var clean = name.Trim();
        var root = Path.Combine(parentDir, clean);
        if (Directory.Exists(root) && Directory.EnumerateFileSystemEntries(root).Any())
            throw new InvalidOperationException($"{root} already exists and is not empty.");
        Directory.CreateDirectory(root);

        var greeting = Regex.Replace(clean, "[\"\\\\\\n]", "");
        var files = new Dictionary<string, string>
        {
            ["README.md"] = $"# {clean}\n\nCreated with CodeChroma.\n",
            [".gitignore"] = ".codechroma/\n__pycache__/\nnode_modules/\n.venv/\n",
            [Path.Combine("src", "main.py")] = $"def main() -> None:\n    print(\"Hello from {greeting}\")\n\n\nif __name__ == \"__main__\":\n    main()\n",
        };
        foreach (var (relative, content) in files)
        {
            var target = Path.Combine(root, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.WriteAllText(target, content);
        }
        try { (gitInit ?? RunGitInit)(root); }
        catch (Exception) { /* git missing: the project still opens; the bridge copes with a non-git folder. */ }
        return root;
    }

    private static void RunGitInit(string root)
    {
        using var git = Process.Start(new ProcessStartInfo("git", "init") { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true })
            ?? throw new InvalidOperationException("git did not start");
        git.WaitForExit(30_000);
    }
}

public static class BridgeLocation
{
    public const string ExecutableName = "codechroma-bridge";

    public static string Resolve(bool isPackaged, string resourcesPath, string repoRoot, ShellOs os)
    {
        var file = os == ShellOs.Windows ? $"{ExecutableName}.exe" : ExecutableName;
        var candidate = isPackaged
            ? Path.Combine(resourcesPath, "bridge", ExecutableName, file)
            : Path.Combine(repoRoot, "dist", ExecutableName, file);
        if (File.Exists(candidate)) return candidate;
        var how = isPackaged ? "rebuild the desktop installer for this platform" : "`poetry run pyinstaller packaging/bridge.spec`";
        throw new FileNotFoundException($"frozen bridge not found at {candidate} - {how} first");
    }
}
