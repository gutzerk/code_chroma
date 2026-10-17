using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Workspaces;

/// <summary>A domain refusal that maps to an HTTP status (bridge/errors.py's table).</summary>
public sealed class BridgeException(int status, string message, JsonNode? detail = null) : Exception(message)
{
    public int Status { get; } = status;

    public JsonNode Detail => detail ?? JsonValue.Create(Message)!;
}

public sealed record BranchRecord(string Id, string Branch, string Worktree, string CreatedAt)
{
    public bool WorktreeLost { get; set; }

    public JsonObject ToPayload() => new()
    {
        ["id"] = Id, ["branch"] = Branch, ["worktree"] = Worktree, ["created_at"] = CreatedAt, ["worktree_lost"] = WorktreeLost,
    };
}

/// <summary>The branch-workspace registry (.codechroma/branches.json): one worktree per record. Skills are not synced into them.</summary>
public sealed partial class BranchManager
{
    public const string IdPrefix = "br_";
    private const int MaxSlugLength = 48;
    private const string WorkspacesDirEnv = "codechroma_WORKSPACES_DIR";

    private readonly string _mainRoot;
    private readonly object _lock = new();
    private readonly Dictionary<string, BranchRecord> _records = [];

    public BranchManager(string mainRoot)
    {
        _mainRoot = Path.GetFullPath(mainRoot);
        var entries = JsonFile.LoadObject(RegistryPath)["branches"] as JsonArray;
        foreach (var entry in entries ?? [])
            if (FromJson(entry) is { } record) _records[record.Id] = record;
    }

    public string RegistryPath => Path.Combine(_mainRoot, ".codechroma", "branches.json");

    public IReadOnlyList<BranchRecord> List()
    {
        lock (_lock) return [.. _records.Values];
    }

    public BranchRecord Get(string id)
    {
        lock (_lock)
            return _records.TryGetValue(id, out var record) ? record : throw new BridgeException(404, $"'{id}'");
    }

    /// <summary>Prunes stale git worktrees and flags records whose directory was deleted by hand.</summary>
    public void Reconcile()
    {
        if (List().Count == 0) return;
        GitRunner.Run(_mainRoot, "worktree", "prune");
        foreach (var record in List()) record.WorktreeLost = !Directory.Exists(record.Worktree);
    }

    public static IReadOnlyList<string> ListBranches(string root) =>
        (GitRunner.Run(root, "for-each-ref", "--format=%(refname:short)", "refs/heads") ?? "")
            .Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(l => l.TrimEnd('\r')).ToList();

    public static string? CurrentBranch(string root)
    {
        var name = GitRunner.Run(root, "rev-parse", "--abbrev-ref", "HEAD")?.Trim();
        return string.IsNullOrEmpty(name) || name == "HEAD" ? null : name;
    }

    /// <summary>`git worktree list --porcelain` as (path, branch) pairs.</summary>
    public static List<(string Path, string? Branch)> ListWorktrees(string root)
    {
        var entries = new List<(string, string?)>();
        string? path = null, branch = null;
        foreach (var raw in (GitRunner.Run(root, "worktree", "list", "--porcelain") ?? "").Split('\n'))
        {
            var line = raw.TrimEnd('\r');
            if (line.Length == 0)
            {
                if (path is not null) entries.Add((path, branch));
                path = branch = null;
            }
            else if (line.StartsWith("worktree ", StringComparison.Ordinal)) path = line["worktree ".Length..];
            else if (line.StartsWith("branch ", StringComparison.Ordinal)) branch = line["branch ".Length..].Replace("refs/heads/", "", StringComparison.Ordinal);
        }
        if (path is not null) entries.Add((path, branch));
        return entries;
    }

    /// <summary>branch to the id of the workspace that has it checked out (null: a worktree we do not track).</summary>
    public Dictionary<string, string?> Holders()
    {
        var byPath = new Dictionary<string, string>(PathComparer) { [Normalize(_mainRoot)] = Workspace.MainId };
        foreach (var record in List()) byPath[Normalize(record.Worktree)] = record.Id;
        var holders = new Dictionary<string, string?>();
        foreach (var (path, branch) in ListWorktrees(_mainRoot))
            if (branch is not null) holders[branch] = byPath.GetValueOrDefault(Normalize(path));
        return holders;
    }

    public BranchRecord OpenBranch(string branch)
    {
        if (!ListBranches(_mainRoot).Contains(branch)) throw new BridgeException(404, branch);
        lock (_lock)
        {
            var taken = Holders();
            if (taken.TryGetValue(branch, out var holder))
                throw new BridgeException(409, $"branch '{branch}' is already open in {holder ?? "another worktree"}",
                    new JsonObject { ["message"] = $"branch '{branch}' is already open in {holder ?? "another worktree"}", ["workspace"] = holder });
            return Provision(branch, create: false, startPoint: null);
        }
    }

    public BranchRecord CreateBranch(string branch, string? startPoint)
    {
        if (!ValidBranchName(branch)) throw new BridgeException(409, $"'{branch}' is not a valid branch name");
        var existing = ListBranches(_mainRoot);
        if (existing.Contains(branch)) throw new BridgeException(409, $"branch '{branch}' already exists");
        if (startPoint is not null && !existing.Contains(startPoint)) throw new BridgeException(404, startPoint);
        return Provision(branch, create: true, startPoint ?? CurrentBranch(_mainRoot));
    }

    public BranchRecord Delete(string id, bool removeWorktree)
    {
        lock (_lock)
        {
            var record = Get(id);
            if (removeWorktree) Git(["worktree", "remove", "--force", record.Worktree], "git worktree remove");
            _records.Remove(id);
            Save();
            return record;
        }
    }

    private BranchRecord Provision(string branch, bool create, string? startPoint)
    {
        lock (_lock)
        {
            var id = UniqueId(branch);
            var path = WorktreePath(id);
            EnsureExcluded(".codechroma/");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            if (create)
            {
                var args = new List<string> { "worktree", "add", "-b", branch, path };
                if (startPoint is not null) args.Add(startPoint);
                Git(args, "git worktree add");
            }
            else
            {
                Git(["worktree", "add", path, branch], "git worktree add");
            }
            var record = new BranchRecord(id, branch, path, DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture));
            _records[id] = record;
            Save();
            return record;
        }
    }

    private void Git(IEnumerable<string> args, string description)
    {
        var result = GitRunner.RunRaw(_mainRoot, [.. args]);
        if (result is not { ExitCode: 0 })
            throw new BridgeException(409, result is null ? description : result.Value.Stderr.Trim() is { Length: > 0 } stderr ? stderr : description);
    }

    private bool ValidBranchName(string branch)
    {
        if (string.IsNullOrWhiteSpace(branch) || branch.StartsWith('-')) return false;
        return GitRunner.RunRaw(_mainRoot, "check-ref-format", "--branch", branch) is { ExitCode: 0 };
    }

    private void EnsureExcluded(string pattern)
    {
        var resolved = GitRunner.Run(_mainRoot, "rev-parse", "--git-path", "info/exclude")?.Trim();
        if (string.IsNullOrEmpty(resolved)) return;
        var path = Path.IsPathRooted(resolved) ? resolved : Path.GetFullPath(Path.Combine(_mainRoot, resolved));
        try
        {
            var existing = File.Exists(path) ? File.ReadAllLines(path) : [];
            if (existing.Contains(pattern)) return;
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var prefix = existing.Length == 0 || existing[^1] == "" ? "" : "\n";
            File.AppendAllText(path, prefix + pattern + "\n");
        }
        catch (IOException) { }
    }

    private string WorktreePath(string id)
    {
        var configured = Environment.GetEnvironmentVariable(WorkspacesDirEnv)?.Trim();
        return string.IsNullOrEmpty(configured)
            ? Path.Combine(_mainRoot, ".codechroma", "worktrees", id)
            : Path.Combine(Path.GetFullPath(configured), Slugify(Path.GetFileName(_mainRoot), 1), id);
    }

    private string UniqueId(string branch)
    {
        var baseId = IdPrefix + Slugify(branch, _records.Count + 1);
        var candidate = baseId;
        for (var suffix = 2; _records.ContainsKey(candidate) || Directory.Exists(WorktreePath(candidate)); suffix++)
            candidate = $"{baseId}-{suffix}";
        return candidate;
    }

    /// <summary>Lowercase ASCII slug for a branch and directory name; agent&lt;n&gt; when nothing survives.</summary>
    public static string Slugify(string title, int fallbackIndex)
    {
        var folded = new string(title.Normalize(NormalizationForm.FormKD).Where(c => c < 128).ToArray());
        var slug = NonSlug().Replace(folded.ToLowerInvariant(), "-").Trim('-');
        slug = (slug.Length > MaxSlugLength ? slug[..MaxSlugLength] : slug).Trim('-');
        return slug.Length > 0 ? slug : $"agent{fallbackIndex}";
    }

    [GeneratedRegex("[^a-z0-9]+")]
    private static partial Regex NonSlug();

    private void Save()
    {
        var payload = new JsonObject
        {
            ["version"] = 1,
            ["branches"] = new JsonArray(_records.Values.Select(r => (JsonNode?)new JsonObject
            {
                ["id"] = r.Id, ["branch"] = r.Branch, ["worktree"] = r.Worktree, ["created_at"] = r.CreatedAt,
            }).ToArray()),
        };
        JsonFile.Write(RegistryPath, payload);
    }

    private static BranchRecord? FromJson(JsonNode? raw)
    {
        if (raw is not JsonObject o) return null;
        var values = new[] { "id", "branch", "worktree", "created_at" }.Select(k => Json.Str(o[k])).ToArray();
        if (values.Any(string.IsNullOrEmpty) || !values[0]!.StartsWith(IdPrefix, StringComparison.Ordinal)) return null;
        return new BranchRecord(values[0]!, values[1]!, values[2]!, values[3]!);
    }

    private static StringComparer PathComparer => OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;

    private static string Normalize(string path) => Path.GetFullPath(path).TrimEnd('\\', '/').Replace('\\', '/');
}
