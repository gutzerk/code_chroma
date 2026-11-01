using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests;

public class RecentReposTests
{
    private static string Repo(TempDir temp, string name) => temp.Dir(name);

    [Theory]
    [InlineData(null)]
    [InlineData("{not json")]
    [InlineData("""{"a":1}""")]
    public void Missing_or_corrupt_store_reads_as_empty(string? content)
    {
        using var temp = new TempDir();
        var store = RecentRepos.StorePath(temp.Path);
        if (content is not null) File.WriteAllText(store, content);

        Assert.Empty(RecentRepos.Read(store));
    }

    [Fact]
    public void Entries_whose_directory_is_gone_are_flagged_not_dropped()
    {
        using var temp = new TempDir();
        var store = RecentRepos.StorePath(temp.Path);
        var alive = Repo(temp, "alive");
        var gone = temp.Sub("since-deleted");
        RecentRepos.Add(store, alive, 1000);
        RecentRepos.Add(store, gone, 2000);

        var result = RecentRepos.Read(store).Select(e => (e.Path, e.Missing)).ToList();

        Assert.Equal([(gone, true), (alive, false)], result);
    }

    [Fact]
    public void Newest_first_and_deduped_by_path()
    {
        using var temp = new TempDir();
        var store = RecentRepos.StorePath(temp.Path);
        var first = Repo(temp, "first");
        var second = Repo(temp, "second");
        RecentRepos.Add(store, first, 1000);
        RecentRepos.Add(store, second, 2000);

        var result = RecentRepos.Add(store, first, 3000);

        Assert.Equal([first, second], result.Select(e => e.Path));
        Assert.Equal(3000, result[0].OpenedAt);
    }

    [Fact]
    public void The_list_is_capped()
    {
        using var temp = new TempDir();
        var store = RecentRepos.StorePath(temp.Path);
        for (var i = 0; i < RecentRepos.MaxRecents + 5; i++) RecentRepos.Add(store, Repo(temp, $"repo-{i}"), i);

        Assert.Equal(RecentRepos.MaxRecents, RecentRepos.Read(store).Count);
    }

    [Theory]
    [InlineData("/Users/me/projects/atlas", "projects/atlas")]
    [InlineData("/atlas", "atlas")]
    [InlineData("/Users/me/web", "me/web")]
    public void Name_is_the_last_two_segments_so_siblings_stay_distinguishable(string path, string expected)
    {
        using var temp = new TempDir();
        var store = RecentRepos.StorePath(temp.Path);

        var result = RecentRepos.Add(store, path, 1);

        Assert.Equal(expected, result[0].Name);
    }

    [Fact]
    public void Forgetting_an_entry_never_touches_the_folder()
    {
        using var temp = new TempDir();
        var store = RecentRepos.StorePath(temp.Path);
        var keep = Repo(temp, "keep");
        var drop = Repo(temp, "drop");
        RecentRepos.Add(store, keep, 1000);
        RecentRepos.Add(store, drop, 2000);

        var next = RecentRepos.Remove(store, drop);

        Assert.Equal([keep], next.Select(e => e.Path));
        Assert.True(Directory.Exists(drop));
    }

    [Fact]
    public void Reads_a_file_in_the_camel_case_store_format()
    {
        using var temp = new TempDir();
        var store = RecentRepos.StorePath(temp.Path);
        var repo = Repo(temp, "r");
        File.WriteAllText(store, System.Text.Json.JsonSerializer.Serialize(new[] { new { path = repo, name = "r", openedAt = 123 } }));

        var entry = Assert.Single(RecentRepos.Read(store));

        Assert.Equal((repo, "r", 123L), (entry.Path, entry.Name, entry.OpenedAt));
    }
}

public class WorkspaceSummariesTests
{
    private static void Write(string repo, string file, string json)
    {
        Directory.CreateDirectory(Path.Combine(repo, ".codechroma"));
        File.WriteAllText(Path.Combine(repo, ".codechroma", file), json);
    }

    public static IEnumerable<object[]> Cases() =>
    [
        ["no files", null, null, ""],
        ["corrupt file", "{not json", null, ""],
        ["branches by id and name", """{"branches":[{"id":"br_a","name":"Feature Auth","branch":"feat/auth"}],"active":"br_a"}""", null, "br_a=Feature Auth"],
        ["branch name falls back to branch", """{"branches":[{"id":"br_a","branch":"feat/auth"}]}""", null, "br_a=feat/auth"],
        ["agent ids are not listed", """{"branches":[{"id":"agent-1","name":"Agent"}]}""", null, ""],
        ["prs with and without title", null, """[{"number":42,"title":"Fix login bug"},{"number":7}]""", "pr-42=PR #42: Fix login bug|pr-7=PR #7"],
        ["branches first", """{"branches":[{"id":"br_a","name":"A"}]}""", """[{"number":42,"title":"Fix"}]""", "br_a=A|pr-42=PR #42: Fix"],
        ["malformed entries skipped", """{"branches":[{"name":"No id"},"not an object"]}""", """[{"number":"x"}]""", ""],
    ];

    [Theory]
    [MemberData(nameof(Cases))]
    public void Lists_worktrees_and_prs_without_ever_throwing(string _, string? branches, string? prs, string expected)
    {
        using var temp = new TempDir();
        if (branches is not null) Write(temp.Path, "branches.json", branches);
        if (prs is not null) Write(temp.Path, "prs.json", prs);

        var result = string.Join("|", WorkspaceSummaries.ForRepo(temp.Path).Select(w => $"{w.Id}={w.Label}"));

        Assert.Equal(expected, result);
    }
}

public class NewProjectTests
{
    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(".")]
    [InlineData("..")]
    [InlineData("a/b")]
    [InlineData("a\\b")]
    [InlineData("bad:name")]
    [InlineData("trailing.")]
    public void Invalid_names_are_rejected(string name) => Assert.NotNull(NewProject.Validate(name));

    [Fact]
    public void A_plain_name_is_accepted() => Assert.Null(NewProject.Validate("my-app"));

    [Fact]
    public void Creates_the_scaffold_and_initialises_git()
    {
        using var temp = new TempDir();

        var root = NewProject.Create(temp.Path, "demo");

        Assert.Equal(Path.Combine(temp.Path, "demo"), root);
        Assert.Contains("# demo", File.ReadAllText(Path.Combine(root, "README.md")));
        Assert.True(File.Exists(Path.Combine(root, "src", "main.py")));
        Assert.True(Directory.Exists(Path.Combine(root, ".git")));
    }

    [Fact]
    public void A_missing_git_does_not_fail_the_project()
    {
        using var temp = new TempDir();

        var root = NewProject.Create(temp.Path, "demo", gitInit: _ => throw new System.ComponentModel.Win32Exception("git not found"));

        Assert.True(File.Exists(Path.Combine(root, "README.md")));
    }

    [Fact]
    public void Refuses_a_non_empty_existing_folder()
    {
        using var temp = new TempDir();
        File.WriteAllText(Path.Combine(temp.Dir("demo"), "x.txt"), "x");

        Assert.Contains("not empty", Assert.Throws<InvalidOperationException>(() => NewProject.Create(temp.Path, "demo")).Message);
    }

    [Fact]
    public void Refuses_a_missing_parent_directory()
    {
        using var temp = new TempDir();

        Assert.Contains("does not exist", Assert.Throws<InvalidOperationException>(() => NewProject.Create(temp.Sub("nope"), "demo")).Message);
    }
}

public class BridgeLocationTests
{
    [Theory]
    [InlineData(ShellOs.Windows, true, ".exe")]
    [InlineData(ShellOs.MacOs, true, "")]
    [InlineData(ShellOs.Linux, true, "")]
    [InlineData(ShellOs.Windows, false, ".exe")]
    [InlineData(ShellOs.Linux, false, "")]
    public void Finds_the_bridge_packaged_or_in_the_build_output(ShellOs os, bool packaged, string extension)
    {
        using var temp = new TempDir();
        var folder = packaged ? temp.Dir("bridge", "codechroma-bridge") : temp.Dir("dist", "codechroma-bridge");
        var executable = Path.Combine(folder, "codechroma-bridge" + extension);
        File.WriteAllText(executable, "");

        var resolved = BridgeLocation.Resolve(packaged, temp.Path, temp.Path, os);

        Assert.Equal(executable, resolved);
    }

    [Theory]
    [InlineData(true, "rebuild the desktop installer")]
    [InlineData(false, "rebuild with -p:BundleCSharpBridge=true")]
    public void A_missing_bridge_says_how_to_build_it(bool packaged, string hint)
    {
        using var temp = new TempDir();

        var error = Assert.Throws<FileNotFoundException>(() => BridgeLocation.Resolve(packaged, temp.Path, temp.Path, ShellOs.Windows));

        Assert.Contains(hint, error.Message);
    }
}
