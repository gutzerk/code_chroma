using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using CodeChroma.Bridge.Agents;

namespace CodeChroma.Bridge.Prs;

/// <summary>A pull request the user named; owner and repo are null when they only gave a number.</summary>
public sealed record PrReference(int Number, string? Owner = null, string? Repo = null);

/// <summary>Reading a pull request's identity from what the user pasted, and its metadata from `gh`.</summary>
public static partial class GithubCli
{
    private const string MetadataFields =
        "number,title,url,state,author,headRefName,headRefOid,baseRefName,isCrossRepository,headRepositoryOwner,additions,deletions,changedFiles";

    [GeneratedRegex(@"github\.com[/:](?<owner>[^/]+)/(?<repo>[^/]+?)(?:\.git)?/pull/(?<number>\d+)")]
    private static partial Regex PrUrl();

    [GeneratedRegex(@"^#?(?<number>\d+)$")]
    private static partial Regex BareNumber();

    /// <summary>The pull request the input names, or null when it names none: a URL, #123 or 123.</summary>
    public static PrReference? ParseReference(JsonNode? raw)
    {
        if (raw is not JsonValue value || !value.TryGetValue<string>(out var text)) return null;
        text = text.Trim();
        if (text.Length == 0) return null;
        var match = PrUrl().Match(text);
        if (match.Success && int.TryParse(match.Groups["number"].Value, out var urlNumber))
            return new PrReference(urlNumber, match.Groups["owner"].Value, match.Groups["repo"].Value);
        var bare = BareNumber().Match(text);
        return bare.Success && int.TryParse(bare.Groups["number"].Value, out var number) ? new PrReference(number) : null;
    }

    /// <summary>The current checkout's GitHub owner/repo as resolved by `gh`, or null if unresolved.</summary>
    public static (string Owner, string Repo)? RepositorySlug(string repoRoot)
    {
        var raw = Gh.Run(repoRoot, "repo", "view", "--json", "nameWithOwner");
        if (raw is null) return null;
        try
        {
            if (JsonNode.Parse(raw) is not JsonObject data || data["nameWithOwner"] is not JsonValue v || !v.TryGetValue<string>(out var slug)) return null;
            var parts = slug.Trim().Split('/', 2);
            return parts.Length == 2 && parts[0].Length > 0 && parts[1].Length > 0 && !parts[1].Contains('/') ? (parts[0], parts[1]) : null;
        }
        catch (JsonException) { return null; }
    }

    /// <summary>Whether the reference belongs to the repository resolved from the current checkout; a bare number can only mean "in this repo".</summary>
    public static bool BelongsToRepository(PrReference reference, string repoRoot)
    {
        if (reference.Owner is null || reference.Repo is null) return true;
        return RepositorySlug(repoRoot) is { } slug
            && string.Equals(reference.Owner, slug.Owner, StringComparison.OrdinalIgnoreCase)
            && string.Equals(reference.Repo, slug.Repo, StringComparison.OrdinalIgnoreCase);
    }

    public static bool IsGithubRepository(string repoRoot) => RepositorySlug(repoRoot) is not null;

    public static bool HasGh() => Gh.Available;

    public static bool IsAuthenticated(string repoRoot) => Gh.Run(repoRoot, "auth", "status") is not null;

    /// <summary>`gh pr list --json ...` as {number, title, head_ref, author}; null if gh failed.</summary>
    public static JsonArray? ListOpenPrs(string repoRoot)
    {
        var raw = Gh.Run(repoRoot, "pr", "list", "--json", "number,title,headRefName,author");
        if (raw is null) return null;
        try
        {
            if (JsonNode.Parse(raw) is not JsonArray data) return null;
            return new JsonArray(data.OfType<JsonObject>().Where(i => i["number"] is JsonValue n && n.TryGetValue<int>(out _)).Select(item => (JsonNode?)new JsonObject
            {
                ["number"] = item["number"]!.DeepClone(),
                ["title"] = Text(item["title"]) is { Length: > 0 } title ? title : $"#{item["number"]}",
                ["head_ref"] = Text(item["headRefName"]),
                ["author"] = AuthorLogin(item),
            }).ToArray());
        }
        catch (JsonException) { return null; }
    }

    /// <summary>`gh pr view &lt;n&gt; --json ...` parsed, or null when gh failed or the PR does not exist.</summary>
    public static JsonObject? FetchMetadata(string repoRoot, int number)
    {
        var raw = Gh.Run(repoRoot, "pr", "view", number.ToString(), "--json", MetadataFields);
        if (raw is null) return null;
        try { return JsonNode.Parse(raw) is JsonObject data && Truthy(data["headRefOid"]) ? data : null; }
        catch (JsonException) { return null; }
    }

    public static string HeadOwner(JsonObject metadata) => Login(metadata["headRepositoryOwner"]);

    public static string AuthorLogin(JsonObject metadata) => Login(metadata["author"]);

    /// <summary>Issue-level PR discussion (not tied to a file or line), via `gh pr view --json comments`.</summary>
    public static JsonArray FetchGeneralComments(string repoRoot, int number)
    {
        var raw = Gh.Run(repoRoot, "pr", "view", number.ToString(), "--json", "comments");
        if (raw is null) return [];
        try
        {
            return JsonNode.Parse(raw) is JsonObject data && data["comments"] is JsonArray comments ? Normalize(comments) : [];
        }
        catch (JsonException) { return []; }
    }

    /// <summary>Inline comments on a diff line, via the REST pulls/{n}/comments endpoint.</summary>
    public static JsonArray FetchReviewComments(string repoRoot, int number)
    {
        if (RepositorySlug(repoRoot) is not { } slug) return [];
        var raw = Gh.Run(repoRoot, "api", $"repos/{slug.Owner}/{slug.Repo}/pulls/{number}/comments", "--paginate");
        if (raw is null) return [];
        try { return JsonNode.Parse(raw) is JsonArray data ? Normalize(data) : []; }
        catch (JsonException) { return []; }
    }

    private static JsonArray Normalize(JsonArray comments) =>
        new(comments.OfType<JsonObject>().Select(c => (JsonNode?)NormalizeComment(c)).ToArray());

    /// <summary>One comment as {author, body, created_at, path, line}, whichever gh shape it came from.</summary>
    private static JsonObject NormalizeComment(JsonObject raw)
    {
        var authorField = raw["author"] as JsonObject ?? raw["user"] as JsonObject;
        var created = Text(raw["createdAt"]) is { Length: > 0 } c ? c : Text(raw["created_at"]);
        var path = Text(raw["path"]);
        return new JsonObject
        {
            ["author"] = authorField is not null ? Text(authorField["login"]) : "",
            ["body"] = Text(raw["body"]),
            ["created_at"] = created,
            ["path"] = path.Length > 0 ? path.Trim('/') : null,
            ["line"] = AsLine(raw["line"]) ?? AsLine(raw["original_line"]),
        };
    }

    private static int? AsLine(JsonNode? value) => value is JsonValue v && v.TryGetValue<int>(out var line) ? line : null;

    private static string Login(JsonNode? field) =>
        field is JsonObject o ? Text(o["login"]) : Text(field);

    private static string Text(JsonNode? node) => node is JsonValue v && v.TryGetValue<string>(out var s) ? s : "";

    private static bool Truthy(JsonNode? node) => Text(node).Length > 0;
}
