using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Tests.Support;

namespace CodeChroma.Bridge.Tests.Agents;

/// <summary>Port of tests/unit/test_agent_bootstrap.py: preflight, the first-commit plan, and a worktree that really works afterwards.</summary>
[Collection("Env")]
public class AgentBootstrapTests : IDisposable
{
    private readonly GitSandbox _project = new(initGit: false);
    private readonly string? _previousEnv = Environment.GetEnvironmentVariable(WorktreeOps.WorkspacesDirEnv);

    public void Dispose()
    {
        Environment.SetEnvironmentVariable(WorktreeOps.WorkspacesDirEnv, _previousEnv);
        _project.Dispose();
    }

    private void InitRepo(bool commit)
    {
        _project.Git("init", "-q");
        _project.Git("config", "user.email", "test@example.com");
        _project.Git("config", "user.name", "Test");
        if (commit) _project.Git("commit", "-q", "-m", "initial", "--allow-empty");
    }

    [Fact]
    public void Preflight_reports_not_a_repo_with_a_commit_plan()
    {
        var result = AgentBootstrap.Preflight(_project.Root);

        Assert.Equal("not-a-repo", (string?)result["state"]);
        Assert.Equal(1, (int)result["plan"]!["file_count"]!);
        Assert.Equal("value = 1\n".Length, (long)result["plan"]!["total_bytes"]!);
    }

    [Fact]
    public void Preflight_reports_no_commits_on_an_unborn_head_and_ready_on_a_normal_repository()
    {
        InitRepo(commit: false);
        var unborn = AgentBootstrap.Preflight(_project.Root);
        _project.Git("add", "-A");
        _project.Git("commit", "-q", "-m", "initial");
        var ready = AgentBootstrap.Preflight(_project.Root);

        Assert.Equal("no-commits", (string?)unborn["state"]);
        Assert.NotNull(unborn["plan"]);
        Assert.Equal("ready", (string?)ready["state"]);
    }

    [Fact]
    public void Preflight_refuses_a_directory_inside_someone_elses_repository()
    {
        InitRepo(commit: true);
        var nested = Path.Combine(_project.Root, "sub", "inner");
        Directory.CreateDirectory(nested);

        var result = AgentBootstrap.Preflight(nested);

        Assert.Equal("nested", (string?)result["state"]);
        Assert.Equal(Path.GetFullPath(_project.Root).TrimEnd('\\', '/'), Path.GetFullPath((string)result["parent_repo"]!).TrimEnd('\\', '/'), ignoreCase: true);
    }

    [Fact]
    public void The_commit_plan_respects_an_existing_gitignore_and_extra_ignores()
    {
        _project.Write(".gitignore", "secrets.txt\nlogs/\n");
        _project.Write("secrets.txt", "token");
        _project.Write("logs/run.log", "noise");
        _project.Write("generated/out.js", new string('x', 100));

        var plain = AgentBootstrap.CommitPlan(_project.Root);
        var extra = AgentBootstrap.CommitPlan(_project.Root, ["generated/"]);

        Assert.Equal(3, (int)plain["file_count"]!);
        Assert.DoesNotContain(plain["suspicious"]!.AsArray(), e => (string?)e!["path"] == "secrets.txt");
        Assert.Equal(2, (int)extra["file_count"]!);
    }

    [Fact]
    public void Include_un_excludes_a_preticked_path()
    {
        _project.Write(".env", "SECRET=1");

        var byDefault = AgentBootstrap.CommitPlan(_project.Root);
        var kept = AgentBootstrap.CommitPlan(_project.Root, include: [".env"]);

        Assert.Equal(1, (int)byDefault["file_count"]!);
        Assert.Equal(2, (int)kept["file_count"]!);
        Assert.False((bool)kept["suspicious"]![0]!["preticked"]!);
    }

    [Fact]
    public void Dotenv_and_dependency_directories_land_in_the_suspicious_list_preticked()
    {
        _project.Write(".env", "SECRET=1");
        _project.Write("node_modules/left-pad.js", "x");

        var plan = AgentBootstrap.CommitPlan(_project.Root);

        var byPath = plan["suspicious"]!.AsArray().ToDictionary(e => (string)e!["path"]!, e => e!);
        Assert.True((bool)byPath[".env"]["preticked"]!);
        Assert.True((bool)byPath["node_modules/"]["preticked"]!);
        Assert.True((bool)byPath["node_modules/"]["already_ignored"]!);
    }

    [Fact]
    public void Private_keys_and_large_files_are_flagged()
    {
        _project.Write("server.pem", "-----BEGIN-----");
        File.WriteAllBytes(Path.Combine(_project.Root, "blob.bin"), new byte[AgentBootstrap.LargeFileBytes + 1]);

        var plan = AgentBootstrap.CommitPlan(_project.Root);

        var reasons = plan["suspicious"]!.AsArray().ToDictionary(e => (string)e!["path"]!, e => (string)e!["reason"]!);
        Assert.Contains("private keys", reasons["server.pem"]);
        Assert.Contains("5 MB", reasons["blob.bin"]);
    }

    [Fact]
    public void Initialize_creates_a_gitignore_when_none_exists_and_never_rewrites_one()
    {
        AgentBootstrap.Initialize(_project.Root, ["node_modules/"]);
        var written = File.ReadAllText(Path.Combine(_project.Root, ".gitignore"));
        using var other = new GitSandbox(initGit: false);
        other.Write(".gitignore", "mine.txt\n");

        var result = AgentBootstrap.Initialize(other.Root, ["node_modules/"]);

        Assert.Contains(".codechroma/", written);
        Assert.Contains("node_modules/", written);
        Assert.Equal("mine.txt\n", File.ReadAllText(Path.Combine(other.Root, ".gitignore")));
        Assert.False((bool)result["created_gitignore"]!);
    }

    [Fact]
    public void Initialize_is_a_no_op_on_a_ready_repository()
    {
        InitRepo(commit: true);

        var result = AgentBootstrap.Initialize(_project.Root);

        Assert.Equal("""{"state":"ready","created_repo":false,"created_gitignore":false}""", result.ToJsonString());
    }

    [Fact]
    public void Initialize_refuses_when_everything_would_be_ignored()
    {
        using var ignored = new GitSandbox(initGit: false);
        ignored.Write(".gitignore", "*\n");

        var error = Assert.Throws<BootstrapException>(() => AgentBootstrap.Initialize(ignored.Root));

        Assert.Contains("nothing to commit", error.Message);
    }

    [Fact]
    public void A_worktree_add_succeeds_after_git_init()
    {
        Environment.SetEnvironmentVariable(WorktreeOps.WorkspacesDirEnv, _project.Sibling("worktrees"));
        AgentBootstrap.Initialize(_project.Root, ["node_modules/"]);

        var path = WorktreeOps.Add(_project.Root, "agent/first", WorktreeOps.WorktreePath(_project.Root, "first"));

        Assert.Equal("value = 1\n", File.ReadAllText(Path.Combine(path, "app.py")).Replace("\r\n", "\n"));
    }

    [Fact]
    public void Initialize_completes_an_unborn_head_repository()
    {
        InitRepo(commit: false);

        var result = AgentBootstrap.Initialize(_project.Root);

        Assert.False((bool)result["created_repo"]!);
        Assert.False(string.IsNullOrEmpty((string?)result["commit"]));
    }
}

public class SkillSyncTests : IDisposable
{
    private readonly GitSandbox _repo = new();

    public void Dispose() => _repo.Dispose();

    private static string FakeSkill(string parent)
    {
        var dir = Path.Combine(parent, "src-skill");
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "SKILL.md"), "fresh");
        return dir;
    }

    [Fact]
    public void A_skill_is_installed_into_a_repo_without_one_and_a_stale_copy_is_replaced()
    {
        var source = FakeSkill(_repo.Sibling("src"));
        var target = Path.Combine(_repo.Root, ".claude", "skills", "demo");
        Directory.CreateDirectory(target);
        File.WriteAllText(Path.Combine(target, "stale.md"), "old");

        var installed = SkillSync.SyncSkill(_repo.Root, "demo", source);

        Assert.Equal(target, installed);
        Assert.Equal("fresh", File.ReadAllText(Path.Combine(target, "SKILL.md")));
        Assert.False(File.Exists(Path.Combine(target, "stale.md")));
    }

    [Fact]
    public void A_missing_source_is_skipped()
    {
        Assert.Null(SkillSync.SyncSkill(_repo.Root, "demo", Path.Combine(_repo.Root, "no-such-dir")));
    }

    [Fact]
    public void Exclude_patterns_cover_every_skill_including_the_retired_ones()
    {
        foreach (var name in SkillSync.SkillNames.Concat(SkillSync.RetiredSkillNames))
            Assert.Contains($".claude/skills/{name}/", SkillSync.ExcludePatterns);
        Assert.Equal(".codechroma/", SkillSync.WorktreeExcludes[0]);
    }

    [Theory]
    [InlineData("codechroma-c1")]
    [InlineData("codechroma-patterns")]
    [InlineData("codechroma-wiki-general")]
    public void Syncing_removes_a_skill_a_previous_version_installed(string retired)
    {
        var stale = Path.Combine(_repo.Root, ".claude", "skills", retired);
        Directory.CreateDirectory(stale);
        File.WriteAllText(Path.Combine(stale, "SKILL.md"), "old");

        SkillSync.PruneRetired(_repo.Root);

        Assert.False(Directory.Exists(stale));
    }

    [Fact]
    public void Syncing_removes_a_skill_installed_under_the_former_codeatlas_name()
    {
        var stale = Path.Combine(_repo.Root, ".claude", "skills", "codeatlas-draw-diagram");
        Directory.CreateDirectory(stale);
        File.WriteAllText(Path.Combine(stale, "SKILL.md"), "old");

        SkillSync.PruneRetired(_repo.Root);

        Assert.False(Directory.Exists(stale));
    }

    [Fact]
    public void Install_into_worktree_syncs_every_shipped_skill_and_excludes_them_from_git_status()
    {
        SkillSync.InstallIntoWorktree(_repo.Root);

        foreach (var name in SkillSync.SkillNames)
            Assert.True(File.Exists(Path.Combine(_repo.Root, ".claude", "skills", name, "SKILL.md")), name);
        Assert.Equal("", _repo.Git("status", "--porcelain").Trim());
    }

    [Fact]
    public void The_draw_diagram_router_and_its_references_ship_with_the_skill()
    {
        SkillSync.InstallIntoWorktree(_repo.Root);

        var skill = Path.Combine(_repo.Root, ".claude", "skills", "codechroma-draw-diagram");
        Assert.True(File.Exists(Path.Combine(skill, "SKILL.md")));
        Assert.True(Directory.GetFiles(skill, "*.md", SearchOption.AllDirectories).Length > 1);
    }

    [Fact]
    public void The_shipped_skills_sit_in_a_skills_folder_beside_the_bridge_without_any_searching()
    {
        var root = SkillSync.SkillsRoot();

        Assert.Equal(Path.Combine(AppContext.BaseDirectory, "skills"), root);
        foreach (var name in SkillSync.SkillNames) Assert.True(File.Exists(Path.Combine(root!, name, "SKILL.md")), name);
    }

    [Fact]
    public void The_plugin_dir_is_the_parent_of_the_skills_dir()
    {
        var plugin = SkillSync.PluginDir();

        Assert.Equal(AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar), plugin);
    }

    [Fact]
    public void Seeding_copies_main_diagram_artifacts_into_a_new_worktree_without_overwriting()
    {
        var other = _repo.Sibling("seeded");
        _repo.Write(".codechroma/diagrams/c1/c1.json", """{"from":"main"}""");
        _repo.Write(".codechroma/diagrams/patterns/patterns.json", """{"p":1}""");
        Directory.CreateDirectory(Path.Combine(other, ".codechroma", "diagrams", "patterns"));
        File.WriteAllText(Path.Combine(other, ".codechroma", "diagrams", "patterns", "patterns.json"), """{"own":true}""");

        DiagramSeed.SeedFromMain(_repo.Root, other);

        Assert.Equal("""{"from":"main"}""", File.ReadAllText(Path.Combine(other, ".codechroma", "diagrams", "c1", "c1.json")));
        Assert.Equal("""{"own":true}""", File.ReadAllText(Path.Combine(other, ".codechroma", "diagrams", "patterns", "patterns.json")));
        Assert.False(File.Exists(Path.Combine(other, ".codechroma", "diagrams", "impact", "impact.json")));
    }

    [Fact]
    public void Seeding_a_pull_request_copies_canvas_projections_custom_types_and_requirements()
    {
        var pr = _repo.Sibling("pr");
        _repo.Write(".codechroma/canvas-core.json", "{}");
        _repo.Write(".codechroma/diagrams/c1/projection.json", "{\"c\":1}");
        _repo.Write(".codechroma/diagrams/custom/flow/flow.json", "{\"f\":1}");
        _repo.Write("plan/epics/e1.md", "# epic");
        _repo.Write("specs/s1/spec.md", "# spec");

        DiagramSeed.SeedPullRequestFromMain(pr, _repo.Root);

        Assert.True(File.Exists(Path.Combine(pr, ".codechroma", "canvas-core.json")));
        Assert.True(File.Exists(Path.Combine(pr, ".codechroma", "diagrams", "c1", "projection.json")));
        Assert.True(File.Exists(Path.Combine(pr, ".codechroma", "diagrams", "custom", "flow", "flow.json")));
        Assert.True(File.Exists(Path.Combine(pr, "plan", "epics", "e1.md")));
        Assert.True(File.Exists(Path.Combine(pr, "specs", "s1", "spec.md")));
    }
}
