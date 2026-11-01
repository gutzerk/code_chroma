using System.Globalization;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Workspaces;

/// <summary>A domain refusal that maps to an HTTP status (bridge/errors.py's table).</summary>
public class BridgeException(int status, string message, JsonNode? detail = null) : Exception(message)
{
    public int Status { get; } = status;

    public JsonNode Detail => detail ?? JsonValue.Create(Message)!;
}

public sealed record BranchRecord(string Id, string Branch, string Worktree, string CreatedAt)
{
    public bool WorktreeLost { get; set; }

    /// <summary>The tab's display name; follows the git branch on rename (the branch itself on legacy records).</summary>
    public string Name { get; set; } = Branch;

    public JsonObject ToPayload(int dirty = 0) => new()
    {
        ["id"] = Id, ["name"] = Name, ["branch"] = Branch, ["worktree"] = Worktree, ["created_at"] = CreatedAt,
        ["worktree_lost"] = WorktreeLost, ["dirty"] = dirty,
    };
}

/// <summary>The branch-workspace registry (.codechroma/branches.json): one worktree per record, with skills installed and diagrams seeded like an agent's.</summary>
public sealed partial class BranchManager
{
    public const string IdPrefix = "br_";
    private const int MaxSlugLength = 48;
    private const string WorkspacesDirEnv = "codechroma_WORKSPACES_DIR";

    private readonly string _mainRoot;
    private const int FetchTimeoutSeconds = 20;
    private const string AutoPrefix = "wt-";

    private readonly object _lock = new();
    private readonly object _ensureLock = new();
    private readonly object _createLock = new();
    private readonly List<BranchRecord> _records = [];
    private string? _activeId;

    public BranchManager(string mainRoot)
    {
        _mainRoot = Path.GetFullPath(mainRoot);
        var raw = JsonFile.LoadObject(RegistryPath);
        foreach (var entry in raw["branches"] as JsonArray ?? [])
            if (FromJson(entry) is { } record && _records.All(r => r.Id != record.Id)) _records.Add(record);
        _activeId = Json.Str(raw["active"]);
    }

    /// <summary>Worktrees other registries own (agents), so a branch an agent holds reads as taken by that agent.</summary>
    public Func<IReadOnlyList<(string Worktree, string Id)>> ExtraHolders { get; set; } = () => [];

    public string RegistryPath => Path.Combine(_mainRoot, ".codechroma", "branches.json");

    public IReadOnlyList<BranchRecord> List()
    {
        lock (_lock) return [.. _records];
    }

    public BranchRecord Get(string id)
    {
        lock (_lock)
            return _records.FirstOrDefault(r => r.Id == id) ?? throw new BridgeException(404, $"'{id}'");
    }

    public BranchRecord? Find(string id)
    {
        lock (_lock) return _records.FirstOrDefault(r => r.Id == id);
    }

    /// <summary>The stored active tab id when it still names a record, else null.</summary>
    public string? ActiveId
    {
        get
        {
            lock (_lock) return _activeId is not null && _records.Any(r => r.Id == _activeId) ? _activeId : null;
        }
    }

    public void SetActive(string id)
    {
        lock (_lock)
        {
            Get(id);
            _activeId = id;
            Save();
        }
    }

    /// <summary>The record as the API reports it: live worktree health plus how many paths its tree has uncommitted changes in.</summary>
    public JsonObject Payload(BranchRecord record)
    {
        record.WorktreeLost = !Directory.Exists(record.Worktree);
        return record.ToPayload(record.WorktreeLost ? 0 : Publish.DirtyFiles(record.Worktree).Count);
    }

    /// <summary>Payloads for many records, their git status runs in parallel.</summary>
    public List<JsonObject> Payloads(IReadOnlyList<BranchRecord> records)
    {
        var payloads = new JsonObject[records.Count];
        Parallel.For(0, records.Count, new ParallelOptions { MaxDegreeOfParallelism = 8 }, i => payloads[i] = Payload(records[i]));
        return [.. payloads];
    }

    /// <summary>Prunes stale git worktrees and flags records whose directory was deleted by hand.</summary>
    public void Reconcile()
    {
        if (List().Count == 0) return;
        GitRunner.Run(_mainRoot, "worktree", "prune");
        foreach (var record in List())
        {
            record.WorktreeLost = !Directory.Exists(record.Worktree);
            if (!record.WorktreeLost) SkillSync.InstallIntoWorktree(record.Worktree);
        }
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
        foreach (var (worktree, id) in ExtraHolders()) byPath.TryAdd(Normalize(worktree), id);
        var holders = new Dictionary<string, string?>();
        foreach (var (path, branch) in ListWorktrees(_mainRoot))
            if (branch is not null) holders[branch] = byPath.GetValueOrDefault(Normalize(path));
        return holders;
    }

    /// <summary>Creates the first tab when none exist; restores nothing otherwise. Returns the tabs and the tab to show.</summary>
    public (IReadOnlyList<BranchRecord> Records, string Active) EnsureAny()
    {
        lock (_ensureLock) { if (List().Count == 0) CreateNext(null); }
        lock (_lock)
        {
            if (_records.Count == 0) throw new BridgeException(409, "no worktree tab could be created");
            if (_activeId is null || _records.All(r => r.Id != _activeId))
            {
                _activeId = _records[^1].Id;
                Save();
            }
            return ([.. _records], _activeId);
        }
    }

    /// <summary>A new tab off the freshest default branch: wt-N (first free) or the given name; the fetch runs unlocked, only name choice and provisioning are serialized.</summary>
    public (BranchRecord Record, bool Fetched, string? Warning) CreateNext(string? name)
    {
        var requested = string.IsNullOrWhiteSpace(name) ? null : name.Trim();
        if (requested is not null) ValidatedName(requested);
        var (startPoint, fetched, warning) = RefreshBase();
        lock (_createLock)
        {
            var branch = ValidatedName(requested ?? NextAutoName());
            var record = Provision(branch, startPoint);
            lock (_lock)
            {
                _activeId = record.Id;
                Save();
            }
            return (record, fetched, warning);
        }
    }

    /// <summary>Fetches origin's default branch (20s, no credential prompt) and picks origin/default, else local default, else HEAD.</summary>
    public (string StartPoint, bool Fetched, string? Warning) RefreshBase()
    {
        var main = WorktreeOps.MainBranch(_mainRoot);
        string warning;
        if (GitRunner.Run(_mainRoot, "remote", "get-url", "origin") is null) warning = "no remote 'origin'; branched from the local default branch";
        else if (FetchOrigin(main, out var failure))
        {
            var remoteRef = $"refs/remotes/origin/{main}";
            if (GitRunner.Run(_mainRoot, "rev-parse", "--verify", "--quiet", remoteRef) is { } sha && sha.Trim().Length > 0)
                return ($"origin/{main}", true, null);
            warning = $"origin has no branch '{main}'; branched from the local default branch";
        }
        else warning = $"could not fetch origin ({failure}); branched from the local default branch";
        var local = GitRunner.Run(_mainRoot, "rev-parse", "--verify", "--quiet", $"refs/heads/{main}") is { } head && head.Trim().Length > 0;
        return (local ? main : "HEAD", false, warning);
    }

    private bool FetchOrigin(string main, out string failure)
    {
        var env = new Dictionary<string, string> { ["GIT_TERMINAL_PROMPT"] = "0" };
        var result = GitRunner.RunRaw(_mainRoot, TimeSpan.FromSeconds(FetchTimeoutSeconds), env, "fetch", "origin", main);
        failure = result switch
        {
            null => $"timed out after {FetchTimeoutSeconds}s",
            { Stderr: var text } when text.Trim().Length > 0 => text.Trim().Split('\n')[0].TrimEnd('\r'),
            _ => "git fetch failed",
        };
        return result is { ExitCode: 0 };
    }

    private string NextAutoName()
    {
        var taken = new HashSet<string>(ListBranches(_mainRoot));
        lock (_lock) foreach (var r in _records) { taken.Add(r.Branch); taken.Add(r.Name); }
        for (var n = 1; ; n++)
        {
            var candidate = $"{AutoPrefix}{n}";
            if (!taken.Contains(candidate)) return candidate;
        }
    }

    private bool BranchTaken(string branch)
    {
        lock (_lock) if (_records.Any(r => r.Branch == branch || r.Name == branch)) return true;
        return ListBranches(_mainRoot).Contains(branch);
    }

    /// <summary>The branch name when it is valid and free, else a 409 (naming whoever holds it).</summary>
    private string ValidatedName(string branch)
    {
        if (!ValidBranchName(branch)) throw new BridgeException(409, $"'{branch}' is not a valid branch name");
        if (!BranchTaken(branch)) return branch;
        var holder = Holders().GetValueOrDefault(branch);
        throw new BridgeException(409, $"branch '{branch}' is already taken" + (holder is null ? "" : $" by {holder}"));
    }

    /// <summary>Renames the display name and the git branch together; id and worktree path stay.</summary>
    public BranchRecord Rename(string id, string name)
    {
        name = name.Trim();
        if (name == Get(id).Branch) return Get(id);
        lock (_createLock)
        {
            ValidatedName(name);
            var branch = Get(id).Branch;
            Git(() => WorktreeOps.RenameBranch(_mainRoot, branch, name));
            lock (_lock)
            {
                var index = _records.FindIndex(r => r.Id == id);
                if (index < 0) throw new BridgeException(404, $"'{id}'");
                _records[index] = _records[index] with { Branch = name, Name = name };
                Save();
                return _records[index];
            }
        }
    }

    /// <summary>Removing the worktree is forced (local changes never block it) and runs unlocked; without it the record stays so the tab returns on the next open.</summary>
    public BranchRecord Delete(string id, bool removeWorktree)
    {
        var record = Get(id);
        if (removeWorktree)
        {
            if (Directory.Exists(record.Worktree)) Git(() => WorktreeOps.Remove(_mainRoot, record.Worktree, force: true));
            else GitRunner.Run(_mainRoot, "worktree", "prune");
        }
        lock (_lock)
        {
            if (removeWorktree) _records.RemoveAll(r => r.Id == id);
            if (_activeId == id) _activeId = null;
            Save();
        }
        return record;
    }

    private BranchRecord Provision(string branch, string startPoint)
    {
        lock (_lock)
        {
            var id = UniqueId(branch);
            var path = WorktreePath(id);
            GitExclude.Ensure(_mainRoot, [.. SkillSync.WorktreeExcludes]);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            Git(() => WorktreeOps.Add(_mainRoot, branch, path, startPoint, track: false));
            try
            {
                SkillSync.InstallIntoWorktree(path);
                DiagramSeed.SeedFromMain(_mainRoot, path);
            }
            catch (Exception)
            {
                UndoProvision(branch, path);
                throw;
            }
            var record = new BranchRecord(id, branch, path, DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture));
            _records.Add(record);
            Save();
            return record;
        }
    }

    /// <summary>Never leave a checkout (and a branch we just made) that no record points at.</summary>
    private void UndoProvision(string branch, string path)
    {
        try
        {
            WorktreeOps.Remove(_mainRoot, path, force: true);
            WorktreeOps.DeleteBranch(_mainRoot, branch);
        }
        catch (WorktreeException) { /* the half-made worktree stays for the user to clean up */ }
    }

    private static void Git(Action operation)
    {
        try { operation(); }
        catch (WorktreeException error) { throw new BridgeException(409, error.Message); }
    }

    private bool ValidBranchName(string branch)
    {
        if (string.IsNullOrWhiteSpace(branch) || branch.StartsWith('-')) return false;
        return GitRunner.RunRaw(_mainRoot, "check-ref-format", "--branch", branch) is { ExitCode: 0 };
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
        for (var suffix = 2; _records.Any(r => r.Id == candidate) || Directory.Exists(WorktreePath(candidate)); suffix++)
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
            ["branches"] = new JsonArray(_records.Select(r => (JsonNode?)new JsonObject
            {
                ["id"] = r.Id, ["name"] = r.Name, ["branch"] = r.Branch, ["worktree"] = r.Worktree, ["created_at"] = r.CreatedAt,
            }).ToArray()),
            ["active"] = _activeId,
        };
        JsonFile.Write(RegistryPath, payload);
    }

    private static BranchRecord? FromJson(JsonNode? raw)
    {
        if (raw is not JsonObject o) return null;
        var values = new[] { "id", "branch", "worktree", "created_at" }.Select(k => Json.Str(o[k])).ToArray();
        if (values.Any(string.IsNullOrEmpty) || !values[0]!.StartsWith(IdPrefix, StringComparison.Ordinal)) return null;
        return new BranchRecord(values[0]!, values[1]!, values[2]!, values[3]!) { Name = Json.Str(o["name"]) is { Length: > 0 } name ? name : values[1]! };
    }

    private static StringComparer PathComparer => OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;

    private static string Normalize(string path) => Path.GetFullPath(path).TrimEnd('\\', '/').Replace('\\', '/');
}
