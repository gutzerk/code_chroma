using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Prs;

/// <summary>The cap on open pull-request reviews is reached (409).</summary>
public sealed class PrLimitException(int number) : BridgeException(409, number.ToString());

/// <summary>No pull request with that number is open (404).</summary>
public sealed class UnknownPrException(int number) : BridgeException(404, number.ToString());

/// <summary>One fetched pull request: its identity, its worktree, and what it compares against.</summary>
public sealed class PrRecord
{
    public const string IdPrefix = "pr-";

    public required int Number { get; init; }
    public required string Title { get; init; }
    public required string Url { get; init; }
    public required string HeadRef { get; init; }
    public required string HeadSha { get; init; }
    public required string BaseRef { get; init; }
    public required string Worktree { get; init; }
    public required string ImportedAt { get; init; }
    public required string FetchedAt { get; init; }
    public string Author { get; init; } = "";
    public string State { get; init; } = "";
    public string HeadRepo { get; init; } = "";
    public bool IsFork { get; init; }
    public int ChangedFiles { get; init; }
    public int Additions { get; init; }
    public int Deletions { get; init; }
    public JsonArray ReviewComments { get; init; } = [];
    public JsonArray GeneralComments { get; init; } = [];

    /// <summary>Runtime only, recomputed at startup: the directory was deleted by hand or by `git clean`.</summary>
    public bool WorktreeLost { get; set; }

    /// <summary>The workspace id the canvas addresses this pull request by.</summary>
    public string Id => IdPrefix + Number;

    public JsonObject ToJson() => Fields();

    /// <summary>Everything the canvas needs, including the derived id and the runtime flags.</summary>
    public JsonObject ToPayload()
    {
        var payload = Fields();
        payload["worktree_lost"] = WorktreeLost;
        payload["id"] = Id;
        return payload;
    }

    private JsonObject Fields() => new()
    {
        ["number"] = Number, ["title"] = Title, ["url"] = Url, ["head_ref"] = HeadRef, ["head_sha"] = HeadSha, ["base_ref"] = BaseRef,
        ["worktree"] = Worktree, ["imported_at"] = ImportedAt, ["fetched_at"] = FetchedAt, ["author"] = Author, ["state"] = State,
        ["head_repo"] = HeadRepo, ["is_fork"] = IsFork, ["changed_files"] = ChangedFiles, ["additions"] = Additions, ["deletions"] = Deletions,
        ["review_comments"] = ReviewComments.DeepClone(), ["general_comments"] = GeneralComments.DeepClone(),
    };

    /// <summary>One record from disk, or null when it cannot be trusted; unknown keys are dropped.</summary>
    public static PrRecord? FromJson(JsonNode? raw)
    {
        if (raw is not JsonObject o) return null;
        if (o["number"] is not JsonValue n || !n.TryGetValue<int>(out var number) || number <= 0) return null;
        var worktree = Json.Str(o["worktree"]);
        if (string.IsNullOrEmpty(worktree)) return null;
        return new PrRecord
        {
            Number = number, Worktree = worktree,
            Title = Text(o["title"]), Url = Text(o["url"]), HeadRef = Text(o["head_ref"]), HeadSha = Text(o["head_sha"]), BaseRef = Text(o["base_ref"]),
            ImportedAt = Text(o["imported_at"]), FetchedAt = Text(o["fetched_at"]), Author = Text(o["author"]), State = Text(o["state"]),
            HeadRepo = Text(o["head_repo"]),
            IsFork = Json.Truthy(o["is_fork"]),
            ChangedFiles = Count(o["changed_files"]), Additions = Count(o["additions"]), Deletions = Count(o["deletions"]),
            ReviewComments = Comments(o["review_comments"]), GeneralComments = Comments(o["general_comments"]),
        };
    }

    public static string Text(JsonNode? value) => Json.Str(value) ?? "";

    public static int Count(JsonNode? value) => value is JsonValue v && v.TryGetValue<int>(out var count) ? count : 0;

    private static JsonArray Comments(JsonNode? value) =>
        value is JsonArray array ? new JsonArray(array.OfType<JsonObject>().Select(o => (JsonNode?)o.DeepClone()).ToArray()) : [];
}

/// <summary>Owns prs.json and the cap; the fetching and the worktree itself live in the importer.</summary>
public sealed class PrManager
{
    public const int MaxPrWorkspaces = 3;
    private const int RegistryVersion = 1;

    private readonly string _mainRoot;
    private readonly object _lock = new();
    private readonly List<PrRecord> _prs = [];

    public PrManager(string mainRoot)
    {
        _mainRoot = Path.GetFullPath(mainRoot);
        if (JsonFile.LoadObject(RegistryPath)["prs"] is JsonArray entries)
            foreach (var entry in entries)
                if (PrRecord.FromJson(entry) is { } record) Put(record);
    }

    /// <summary>In the main repository: the list spans every worktree, so it cannot live in one.</summary>
    public string RegistryPath => Path.Combine(_mainRoot, ".codechroma", "prs.json");

    public IReadOnlyList<PrRecord> List()
    {
        lock (_lock) return [.. _prs];
    }

    public PrRecord? Find(int number)
    {
        lock (_lock) return _prs.FirstOrDefault(p => p.Number == number);
    }

    /// <summary>The PR a workspace id (pr-282) names, or null if it is not one we hold.</summary>
    public PrRecord? FindById(string workspaceId) =>
        workspaceId.StartsWith(PrRecord.IdPrefix, StringComparison.Ordinal) && int.TryParse(workspaceId[PrRecord.IdPrefix.Length..], out var number) ? Find(number) : null;

    public PrRecord Get(int number) => Find(number) ?? throw new UnknownPrException(number);

    public bool AtCapacity()
    {
        lock (_lock) return _prs.Count >= MaxPrWorkspaces;
    }

    /// <summary>Records a fetched pull request; the cap only applies to one that is not open already.</summary>
    public PrRecord Upsert(PrRecord record)
    {
        lock (_lock)
        {
            if (_prs.All(p => p.Number != record.Number) && _prs.Count >= MaxPrWorkspaces) throw new PrLimitException(record.Number);
            Put(record);
            Save();
        }
        return record;
    }

    public PrRecord Delete(int number)
    {
        lock (_lock)
        {
            var record = Get(number);
            _prs.Remove(record);
            Save();
            return record;
        }
    }

    /// <summary>Flags a review whose worktree vanished rather than dropping its card silently; re-seeds the canvas doc for the rest.</summary>
    public void Reconcile()
    {
        foreach (var record in List())
        {
            record.WorktreeLost = !Directory.Exists(record.Worktree);
            if (!record.WorktreeLost) DiagramSeed.SeedCanvasDoc(record.Worktree, _mainRoot);
        }
    }

    private void Put(PrRecord record)
    {
        var index = _prs.FindIndex(p => p.Number == record.Number);
        if (index >= 0) _prs[index] = record;
        else _prs.Add(record);
    }

    private void Save() => JsonFile.Write(RegistryPath, new JsonObject
    {
        ["version"] = RegistryVersion,
        ["prs"] = new JsonArray(_prs.Select(p => (JsonNode?)p.ToJson()).ToArray()),
    });
}
