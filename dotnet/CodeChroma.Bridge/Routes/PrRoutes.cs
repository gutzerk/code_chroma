using System.Globalization;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Http;
using CodeChroma.Bridge.Live;
using CodeChroma.Bridge.Prs;
using CodeChroma.Bridge.Stores;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Routes;

/// <summary>Pull requests as read-only workspaces: fetch one into a worktree, refresh it, close it (routes/prs.py).</summary>
public static class PrRoutes
{
    public const string ReasonLimit = "limit-reached";
    public const string ReasonInvalidRef = "invalid-ref";
    public const string ReasonWrongRepo = "wrong-repo";

    /// <summary>The three GitHub-CLI blockers' text is shared with publish's own button; the rest is PR-specific.</summary>
    public static readonly IReadOnlyDictionary<string, string> ButtonText = new Dictionary<string, string>
    {
        [Publish.ReasonGhMissing] = Publish.ButtonText[Publish.ReasonGhMissing],
        [Publish.ReasonNotAuthenticated] = Publish.ButtonText[Publish.ReasonNotAuthenticated],
        [Publish.ReasonNotGithub] = Publish.ButtonText[Publish.ReasonNotGithub],
        [ReasonLimit] = $"The limit of {PrManager.MaxPrWorkspaces} open PR reviews is reached",
        [ReasonInvalidRef] = "Paste a GitHub pull-request URL, or a number like #123",
        [ReasonWrongRepo] = "That pull request is in another repository",
    };

    public static void Map(WebApplication app, string repoRoot)
    {
        app.MapGet("/prs/preflight", (PrManager prs) => Guard(() =>
        {
            var reason = Blocker(prs, repoRoot);
            return Reply.Json(new JsonObject
            {
                ["ready"] = reason is null,
                ["reason"] = reason,
                ["text"] = reason is null ? null : ButtonText.GetValueOrDefault(reason),
                ["origin"] = GithubCli.RepositorySlug(repoRoot) is { } slug ? new JsonObject { ["owner"] = slug.Owner, ["repo"] = slug.Repo } : null,
                ["count"] = prs.List().Count,
                ["max_prs"] = PrManager.MaxPrWorkspaces,
            });
        }));

        app.MapGet("/prs", (PrManager prs, AgentManager agents) => Guard(() => Reply.Json(new JsonObject
        {
            ["prs"] = new JsonArray(prs.List().Select(p => (JsonNode?)p.ToPayload()).ToArray()),
            ["max_prs"] = PrManager.MaxPrWorkspaces,
            ["active_workspace"] = agents.ActiveWorkspace,
        })));

        app.MapGet("/prs/github", () => Guard(() =>
        {
            if (!GithubCli.HasGh()) return Reply.Error(409, ButtonText[Publish.ReasonGhMissing]);
            if (!GithubCli.IsAuthenticated(repoRoot)) return Reply.Error(409, ButtonText[Publish.ReasonNotAuthenticated]);
            if (!GithubCli.IsGithubRepository(repoRoot)) return Reply.Error(409, ButtonText[Publish.ReasonNotGithub]);
            var list = GithubCli.ListOpenPrs(repoRoot);
            return list is null
                ? Reply.Error(502, "Could not load open pull requests from GitHub; check `gh pr list` and try again")
                : Reply.Json(new JsonObject { ["prs"] = list });
        }));

        app.MapPost("/prs", (HttpRequest request, PrManager prs, WorkspaceRegistry registry, ConnectionManager connections) => GuardAsync(async () =>
        {
            var reference = GithubCli.ParseReference((await Reply.LenientBody(request))["ref"]);
            if (reference is null) return Reply.Error(400, ButtonText[ReasonInvalidRef]);
            if (prs.Find(reference.Number) is { } existing) return Reply.Json(existing.ToPayload());
            var record = await Task.Run(() => Open(prs, registry, repoRoot, reference));
            await connections.Broadcast(new JsonObject { ["type"] = "pr-added", ["pr"] = record.ToPayload() });
            return Reply.Json(record.ToPayload());
        }));

        app.MapPost("/prs/{number:int}/refresh", (int number, PrManager prs, AgentManager agents, WorkspaceRegistry registry, ConnectionManager connections) => GuardAsync(async () =>
        {
            var record = OrNotFound(prs, number);
            GuardNoAttachedAgents(agents, record);
            var previous = record.HeadSha;
            var (updated, moved) = await Task.Run(() => RefreshBlocking(repoRoot, number, record));
            prs.Upsert(updated);
            if (moved) await Task.Run(() => registry.DropLive(updated.Id));
            await connections.Broadcast(new JsonObject { ["type"] = "pr-updated", ["pr"] = updated.ToPayload() });
            await connections.Broadcast(new JsonObject { ["type"] = "changed", ["paths"] = new JsonArray(), ["workspace"] = updated.Id });
            var payload = updated.ToPayload();
            payload["updated"] = moved;
            payload["previous_head_sha"] = previous;
            return Reply.Json(payload);
        }));

        app.MapDelete("/prs/{number:int}", (int number, PrManager prs, AgentManager agents, WorkspaceRegistry registry, ConnectionManager connections) => GuardAsync(async () =>
        {
            var record = OrNotFound(prs, number);
            GuardNoAttachedAgents(agents, record);
            await Task.Run(() =>
            {
                registry.DropLive(record.Id);
                PrImporter.Remove(repoRoot, number, record.Worktree);
            });
            prs.Delete(number);
            await Task.Run(() => registry.Unregister(record.Id));
            if (agents.ActiveWorkspace == record.Id) agents.SetActiveWorkspace(Workspace.MainId);
            await connections.Broadcast(new JsonObject { ["type"] = "pr-removed", ["id"] = record.Id });
            return Reply.Json(new JsonObject { ["status"] = "deleted", ["id"] = record.Id });
        }));
    }

    /// <summary>The first thing stopping a pull request from opening, in the publish preflight's order.</summary>
    private static string? Blocker(PrManager prs, string repoRoot)
    {
        if (!GithubCli.HasGh()) return Publish.ReasonGhMissing;
        if (!GithubCli.IsAuthenticated(repoRoot)) return Publish.ReasonNotAuthenticated;
        if (!GithubCli.IsGithubRepository(repoRoot)) return Publish.ReasonNotGithub;
        return prs.AtCapacity() ? ReasonLimit : null;
    }

    /// <summary>Every gh/git call opening a PR, in one place so the caller offloads it off the request thread.</summary>
    private static PrRecord Open(PrManager prs, WorkspaceRegistry registry, string repoRoot, PrReference reference)
    {
        if (Blocker(prs, repoRoot) is { } blocker) throw new BridgeException(409, ButtonText[blocker]);
        if (!GithubCli.BelongsToRepository(reference, repoRoot)) throw new BridgeException(400, ButtonText[ReasonWrongRepo]);
        var metadata = GithubCli.FetchMetadata(repoRoot, reference.Number) ?? throw new BridgeException(404, $"no pull request #{reference.Number} here");
        var baseRef = PrRecord.Text(metadata["baseRefName"]);
        if (baseRef.Length == 0) throw new BridgeException(409, $"#{reference.Number} names no base branch");
        var (path, sha) = PrImporter.Import(repoRoot, reference.Number, baseRef);
        DiagramSeed.SeedPullRequestFromMain(path, registry.Main.Root);
        var record = ToRecord(repoRoot, reference.Number, metadata, path, sha);
        try { prs.Upsert(record); }
        catch (PrLimitException)
        {
            PrImporter.Remove(repoRoot, reference.Number, path);
            throw new BridgeException(409, ButtonText[ReasonLimit]);
        }
        registry.Register(record.Id, record.Worktree, readOnly: true, baseRef: PrImporter.LocalBaseRef(reference.Number), c1SourceRoot: registry.Main.Root);
        return record;
    }

    /// <summary>The git fetch + gh half of a refresh, in one place so the caller can offload it.</summary>
    private static (PrRecord Updated, bool Moved) RefreshBlocking(string repoRoot, int number, PrRecord record)
    {
        var (sha, moved) = PrImporter.Refresh(repoRoot, number, record.Worktree, record.BaseRef, record.HeadSha);
        var metadata = GithubCli.FetchMetadata(repoRoot, number);
        return (ToRecord(repoRoot, number, metadata, record.Worktree, sha, record.ImportedAt), moved);
    }

    /// <summary>One record from gh's metadata; a failed metadata read keeps the fetch, minus the labels.</summary>
    private static PrRecord ToRecord(string repoRoot, int number, JsonObject? metadata, string worktree, string sha, string? importedAt = null)
    {
        var data = metadata ?? [];
        var now = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.ffffff'Z'", CultureInfo.InvariantCulture);
        return new PrRecord
        {
            Number = number,
            Title = PrRecord.Text(data["title"]) is { Length: > 0 } title ? title : $"#{number}",
            Url = PrRecord.Text(data["url"]),
            HeadRef = PrRecord.Text(data["headRefName"]),
            HeadSha = sha,
            BaseRef = PrRecord.Text(data["baseRefName"]),
            Worktree = worktree,
            ImportedAt = importedAt ?? now,
            FetchedAt = now,
            Author = GithubCli.AuthorLogin(data),
            State = PrRecord.Text(data["state"]),
            HeadRepo = GithubCli.HeadOwner(data),
            IsFork = Json.Truthy(data["isCrossRepository"]),
            ChangedFiles = PrRecord.Count(data["changedFiles"]),
            Additions = PrRecord.Count(data["additions"]),
            Deletions = PrRecord.Count(data["deletions"]),
            ReviewComments = GithubCli.FetchReviewComments(repoRoot, number),
            GeneralComments = GithubCli.FetchGeneralComments(repoRoot, number),
        };
    }

    private static PrRecord OrNotFound(PrManager prs, int number) =>
        prs.Find(number) ?? throw new BridgeException(404, $"no open review for #{number}");

    /// <summary>Refuses to move or remove a PR's worktree while an agent is still attached reviewing it.</summary>
    private static void GuardNoAttachedAgents(AgentManager agents, PrRecord record)
    {
        var attached = agents.AttachedToPr(record.Id);
        if (attached.Count > 0) throw new WorktreeException($"{record.Id} is still in use by agent(s) {string.Join(", ", attached.Select(a => a.Id))}");
    }

    private static IResult Guard(Func<IResult> body)
    {
        try { return body(); }
        catch (BridgeException error) { return Reply.Error(error.Status, error.Detail); }
    }

    private static async Task<IResult> GuardAsync(Func<Task<IResult>> body)
    {
        try { return await body(); }
        catch (BridgeException error) { return Reply.Error(error.Status, error.Detail); }
    }
}
