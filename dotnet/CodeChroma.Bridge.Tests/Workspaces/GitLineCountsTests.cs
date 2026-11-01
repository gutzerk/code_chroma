using CodeChroma.Bridge.Tests.Support;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Tests.Workspaces;

/// <summary>GitTree.LineCounts: numstat for tracked edits, whole-file line counts for untracked additions.</summary>
public class GitLineCountsTests : IDisposable
{
    private readonly GitSandbox _repo = new();

    public void Dispose() => _repo.Dispose();

    [Fact]
    public void Keys_non_ascii_paths_by_their_real_name()
    {
        File.WriteAllText(Path.Combine(_repo.Root, "café.py"), "x\ny\n");
        _repo.CommitAll("accent");
        File.WriteAllText(Path.Combine(_repo.Root, "café.py"), "x\nz\nw\n");
        var tree = GitTree.Detect(_repo.Root)!;

        var counts = tree.LineCounts("HEAD", tree.Status("HEAD").Statuses);

        Assert.Equal((2, 1), counts["café.py"]);
    }

    [Fact]
    public void Skips_an_untracked_file_that_is_not_utf8()
    {
        File.WriteAllBytes(Path.Combine(_repo.Root, "blob.bin"), [0xFF, 0xFE, 0x00, 0x0A, 0x80, 0x0A]);
        var tree = GitTree.Detect(_repo.Root)!;

        var counts = tree.LineCounts("HEAD", tree.Status("HEAD").Statuses);

        Assert.DoesNotContain("blob.bin", counts.Keys);
    }

    [Fact]
    public void Counts_added_and_removed_lines_for_edits_and_all_lines_for_untracked_files()
    {
        File.WriteAllText(Path.Combine(_repo.Root, "app.py"), "changed\n");
        File.WriteAllText(Path.Combine(_repo.Root, "fresh.py"), "a\nb\nc\n");
        var tree = GitTree.Detect(_repo.Root)!;
        var statuses = tree.Status("HEAD").Statuses;

        var counts = tree.LineCounts("HEAD", statuses);

        Assert.True(counts["app.py"].Additions >= 1);
        Assert.Equal((3, 0), counts["fresh.py"]);
    }
}
