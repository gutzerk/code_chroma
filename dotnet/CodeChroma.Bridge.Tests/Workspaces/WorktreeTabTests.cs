using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Tests.Workspaces;

/// <summary>BranchManager as the worktree-tab registry: wt-N creation off a fresh default branch, rename, ensure and delete.</summary>
public class WorktreeTabManagerTests : IDisposable
{
    private readonly GitSandbox _repo = new();

    public void Dispose() => _repo.Dispose();

    private string AddOrigin()
    {
        var origin = Path.Combine(_repo.Sibling("remote"), "origin.git");
        GitSandbox.GitIn(_repo.Sibling("remote"), "init", "-q", "--bare", origin);
        _repo.Git("remote", "add", "origin", origin);
        _repo.Git("push", "-q", "origin", "main");
        return origin;
    }

    [Fact]
    public void Without_a_remote_the_tab_branches_off_local_main_and_warns()
    {
        var manager = new BranchManager(_repo.Root);

        var (record, fetched, warning) = manager.CreateNext(null);

        Assert.Equal("wt-1", record.Branch);
        Assert.False(fetched);
        Assert.NotNull(warning);
        Assert.Equal(_repo.Git("rev-parse", "main").Trim(), _repo.Git("rev-parse", "wt-1").Trim());
        Assert.True(File.Exists(Path.Combine(record.Worktree, "app.py")));
    }

    [Fact]
    public void With_a_remote_the_tab_branches_off_the_freshly_fetched_origin_default_and_leaves_main_alone()
    {
        var origin = AddOrigin();
        var clone = Path.Combine(_repo.Sibling("clone"), "c");
        GitSandbox.GitIn(_repo.Sibling("clone"), "clone", "-q", "-b", "main", origin, "c");
        File.WriteAllText(Path.Combine(clone, "upstream.txt"), "new");
        GitSandbox.GitIn(clone, "add", "-A");
        GitSandbox.GitIn(clone, "-c", "user.email=a@b.c", "-c", "user.name=A", "commit", "-q", "-m", "upstream");
        GitSandbox.GitIn(clone, "push", "-q");
        var mainHead = _repo.Git("rev-parse", "HEAD").Trim();
        var manager = new BranchManager(_repo.Root);

        var (record, fetched, warning) = manager.CreateNext(null);

        Assert.True(fetched);
        Assert.Null(warning);
        Assert.True(File.Exists(Path.Combine(record.Worktree, "upstream.txt")));
        Assert.Equal(mainHead, _repo.Git("rev-parse", "HEAD").Trim());
        Assert.False(File.Exists(Path.Combine(_repo.Root, "upstream.txt")));
        Assert.Throws<InvalidOperationException>(() => _repo.Git("rev-parse", "--abbrev-ref", "wt-1@{upstream}"));
    }

    [Fact]
    public void A_remote_that_cannot_be_fetched_falls_back_to_local_main_with_a_warning()
    {
        _repo.Git("remote", "add", "origin", Path.Combine(_repo.Sibling("missing"), "nowhere.git"));
        var manager = new BranchManager(_repo.Root);

        var (record, fetched, warning) = manager.CreateNext(null);

        Assert.False(fetched);
        Assert.Contains("could not fetch", warning);
        Assert.Equal("wt-1", record.Branch);
    }

    [Fact]
    public async Task Concurrent_creates_get_distinct_wt_numbers()
    {
        var manager = new BranchManager(_repo.Root);

        var made = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => Task.Run(() => manager.CreateNext(null).Record.Branch)));

        Assert.Equal(["wt-1", "wt-2", "wt-3"], made.Order().ToArray());
    }

    [Fact]
    public void Numbering_skips_branches_that_already_exist()
    {
        _repo.Git("branch", "wt-1");
        var manager = new BranchManager(_repo.Root);

        var (record, _, _) = manager.CreateNext(null);

        Assert.Equal("wt-2", record.Branch);
    }

    [Fact]
    public void Ensure_creates_wt_1_once_and_restores_every_tab_afterwards()
    {
        var manager = new BranchManager(_repo.Root);
        var (first, active) = manager.EnsureAny();
        manager.CreateNext(null);

        var (restored, restoredActive) = new BranchManager(_repo.Root).EnsureAny();

        Assert.Single(first);
        Assert.Equal(first[0].Id, active);
        Assert.Equal(["wt-1", "wt-2"], restored.Select(r => r.Branch).ToArray());
        Assert.Equal(restored[1].Id, restoredActive);
    }

    [Fact]
    public void Rename_moves_the_git_branch_but_keeps_the_id_and_worktree()
    {
        var manager = new BranchManager(_repo.Root);
        var original = manager.CreateNext(null).Record;

        var renamed = manager.Rename(original.Id, "feature-x");

        Assert.Equal(original.Id, renamed.Id);
        Assert.Equal(original.Worktree, renamed.Worktree);
        Assert.Equal("feature-x", renamed.Name);
        Assert.Equal("feature-x", renamed.Branch);
        Assert.Equal("feature-x", _repo.Git("-C", original.Worktree, "rev-parse", "--abbrev-ref", "HEAD").Trim());
        Assert.Equal("feature-x", new BranchManager(_repo.Root).Get(original.Id).Name);
    }

    [Fact]
    public void Rename_to_a_taken_or_invalid_branch_is_a_409()
    {
        var manager = new BranchManager(_repo.Root);
        var first = manager.CreateNext(null).Record;
        manager.CreateNext(null);

        var duplicate = Assert.Throws<BridgeException>(() => manager.Rename(first.Id, "wt-2"));
        var held = Assert.Throws<BridgeException>(() => manager.Rename(first.Id, "main"));
        var invalid = Assert.Throws<BridgeException>(() => manager.Rename(first.Id, "bad name"));

        Assert.Equal([409, 409, 409], new[] { duplicate.Status, held.Status, invalid.Status });
        Assert.Equal("wt-1", manager.Get(first.Id).Branch);
    }

    [Fact]
    public void Delete_is_forced_even_with_uncommitted_changes_and_clears_the_active_tab()
    {
        var manager = new BranchManager(_repo.Root);
        var record = manager.CreateNext(null).Record;
        manager.SetActive(record.Id);
        File.WriteAllText(Path.Combine(record.Worktree, "app.py"), "dirty = 1\n");

        Assert.Equal(1, manager.Payload(record)["dirty"]!.GetValue<int>());
        manager.Delete(record.Id, removeWorktree: true);

        Assert.False(Directory.Exists(record.Worktree));
        Assert.Empty(manager.List());
        Assert.Null(manager.ActiveId);
    }

    [Fact]
    public void Delete_without_removing_the_worktree_keeps_the_record_and_the_directory()
    {
        var manager = new BranchManager(_repo.Root);
        var record = manager.CreateNext(null).Record;

        manager.Delete(record.Id, removeWorktree: false);

        Assert.True(Directory.Exists(record.Worktree));
        Assert.Equal([record.Id], manager.List().Select(r => r.Id));
        Assert.Null(manager.ActiveId);
    }

    [Fact]
    public void A_clean_tab_reports_not_dirty_and_a_hand_deleted_worktree_reports_lost()
    {
        var manager = new BranchManager(_repo.Root);
        var record = manager.CreateNext(null).Record;

        var clean = manager.Payload(record);
        _repo.Git("worktree", "remove", "--force", record.Worktree);
        var lost = manager.Payload(record);

        Assert.Equal(0, clean["dirty"]!.GetValue<int>());
        Assert.True(lost["worktree_lost"]!.GetValue<bool>());
    }

    [Fact]
    public void Agents_default_to_their_tab_worktree_and_base_branch()
    {
        var branches = new BranchManager(_repo.Root);
        var tab = branches.CreateNext(null).Record;
        var agents = new AgentManager(_repo.Root) { BranchLookup = branches.Find };

        var record = agents.Create("helper", workspace: tab.Id);

        Assert.Equal(tab.Id, record.Workspace);
        Assert.Equal(tab.Id, record.SharesWorkspaceWith);
        Assert.Equal(tab.Worktree, record.Worktree);
        Assert.Equal(tab.Branch, record.BaseBranch);
        Assert.Equal(tab.Branch, record.Branch);
    }

    [Fact]
    public void Agents_refuse_main_and_a_missing_workspace()
    {
        var agents = new AgentManager(_repo.Root);

        Assert.Throws<WorktreeException>(() => agents.Create("a", attachTo: "main"));
        Assert.Throws<WorktreeException>(() => agents.Create("b"));
        Assert.Throws<WorktreeException>(() => agents.Create("c", workspace: "main"));
        Assert.Throws<UnknownAgentException>(() => agents.Create("d", workspace: "br_nope"));
    }
}

/// <summary>The /branches and /agents routes of the worktree-tab model, over the in-memory bridge.</summary>
public class WorktreeTabRouteTests
{
    private static StringContent Json(object body) => new(JsonSerializer(body), Encoding.UTF8, "application/json");

    private static string JsonSerializer(object body) => System.Text.Json.JsonSerializer.Serialize(body);

    private static async Task<JsonObject> Body(HttpResponseMessage response) => (JsonObject)JsonNode.Parse(await response.Content.ReadAsStringAsync())!;

    [Fact]
    public async Task Ensure_new_rename_active_and_delete_round_trip()
    {
        using var host = new BridgeHost();

        var ensured = await Body(await host.Client.PostAsync("/branches/ensure", null));
        var created = await Body(await host.Client.PostAsync("/branches/new", Json(new { })));
        var second = created["branch"]!["id"]!.GetValue<string>();
        var renamed = await host.Client.PatchAsync($"/branches/{second}", Json(new { name = "topic" }));
        var active = await host.Client.PutAsync("/branches/active", Json(new { id = second }));
        var listed = await Body(await host.Client.GetAsync("/branches"));
        var deleted = await host.Client.DeleteAsync($"/branches/{second}?worktree_too=true");

        Assert.Equal("wt-1", ensured["branches"]![0]!["branch"]!.GetValue<string>());
        Assert.Equal(ensured["branches"]![0]!["id"]!.GetValue<string>(), ensured["active"]!.GetValue<string>());
        Assert.Equal("wt-2", created["branch"]!["name"]!.GetValue<string>());
        Assert.False(created["fetched"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.OK, renamed.StatusCode);
        Assert.Equal(HttpStatusCode.OK, active.StatusCode);
        Assert.Equal(second, listed["active"]!.GetValue<string>());
        Assert.Equal("topic", listed["branches"]![1]!["name"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.OK, deleted.StatusCode);
    }

    [Fact]
    public async Task The_old_choices_and_branch_switch_routes_are_gone()
    {
        using var host = new BridgeHost();

        var choices = await host.Client.GetAsync("/branches/choices");
        var open = await host.Client.PostAsync("/branches", Json(new { branch = "main" }));
        var switchMain = await host.Client.PostAsync("/agents/branch", Json(new { branch = "main" }));
        var update = await host.Client.PostAsync("/agents/branch/update", null);

        Assert.All(new[] { choices, open, switchMain, update }, r => Assert.True(r.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.MethodNotAllowed));
    }

    [Fact]
    public async Task Agents_need_a_tab_and_deleting_the_tab_removes_its_agents()
    {
        using var host = new BridgeHost();
        var tab = (await Body(await host.Client.PostAsync("/branches/ensure", null)))["branches"]![0]!["id"]!.GetValue<string>();

        var none = await host.Client.PostAsync("/agents", Json(new { title = "a" }));
        var main = await host.Client.PostAsync("/agents", Json(new { title = "a", attach_to = "main" }));
        var made = await Body(await host.Client.PostAsync("/agents", Json(new { title = "a", workspace = tab })));
        var deleted = await host.Client.DeleteAsync($"/branches/{tab}?worktree_too=true");
        var agents = await Body(await host.Client.GetAsync("/agents"));

        Assert.Equal(HttpStatusCode.BadRequest, none.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, main.StatusCode);
        Assert.Equal(tab, made["workspace"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.OK, deleted.StatusCode);
        Assert.Empty(agents["agents"]!.AsArray());
    }
}
