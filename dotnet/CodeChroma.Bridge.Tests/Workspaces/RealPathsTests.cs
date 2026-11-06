using System.Diagnostics;
using CodeChroma.Bridge.Routes;
using CodeChroma.Bridge.Workspaces;

namespace CodeChroma.Bridge.Tests.Workspaces;

public class RealPathsTests : IDisposable
{
    private readonly string _base = Directory.CreateTempSubdirectory("cc-real-").FullName;
    private string Repo => Path.Combine(_base, "repo");
    private string Outside => Path.Combine(_base, "outside");

    public RealPathsTests()
    {
        Directory.CreateDirectory(Repo);
        Directory.CreateDirectory(Path.Combine(Outside, "dir"));
        File.WriteAllText(Path.Combine(Outside, "secret"), "outside");
        File.WriteAllText(Path.Combine(Repo, "secret"), "inside");
    }

    public void Dispose() => Directory.Delete(_base, recursive: true);

    private static bool TryLink(string link, string target)
    {
        try { File.CreateSymbolicLink(link, target); return true; }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return false; }
    }

    [Fact]
    public void A_dotdot_in_a_link_target_applies_after_the_link_and_is_rejected()
    {
        if (!TryLink(Path.Combine(Repo, "sub"), Path.Combine(Outside, "dir"))) return;
        TryLink(Path.Combine(Repo, "evil"), Path.Combine("sub", "..", "secret"));

        var resolved = RealPaths.Resolve(Path.Combine(Repo, "evil"));
        var within = SourceText.IsWithin(Repo, Path.Combine(Repo, "evil"));

        Assert.Equal(RealPaths.Resolve(Path.Combine(Outside, "secret")), resolved);
        Assert.False(within);
    }

    [Fact]
    public void A_dotdot_in_the_requested_path_never_reads_outside_the_repo()
    {
        if (!TryLink(Path.Combine(Repo, "sub"), Path.Combine(Outside, "dir"))) return;

        var text = SourceText.ReadWithin(Repo, Path.Combine(Repo, "sub", "..", "secret"));

        Assert.NotEqual("outside", text);
    }

    [Fact]
    public void A_link_target_with_linked_parents_is_resolved_again()
    {
        if (!TryLink(Path.Combine(_base, "alias"), Outside)) return;
        TryLink(Path.Combine(Repo, "via"), Path.Combine(_base, "alias", "dir"));

        var resolved = RealPaths.Resolve(Path.Combine(Repo, "via"));

        Assert.Equal(RealPaths.Resolve(Path.Combine(Outside, "dir")), resolved);
        Assert.DoesNotContain("alias", resolved);
    }

    [Fact]
    public void A_link_into_tmp_resolves_to_the_toplevel_git_reports()
    {
        if (!OperatingSystem.IsMacOS()) return;
        var target = Path.Combine("/tmp", "cc-real-" + Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(target);
        Run("git", "init", "-q", target);
        var link = Path.Combine(Repo, "viatmp");
        TryLink(link, target);

        var resolved = RealPaths.Resolve(link);
        var toplevel = Run("git", "-C", link, "rev-parse", "--show-toplevel").Trim();

        Directory.Delete(target, recursive: true);
        Assert.Equal(toplevel, resolved);
        Assert.StartsWith("/private/tmp/", resolved);
    }

    [Fact]
    public void A_symlink_loop_terminates()
    {
        if (!TryLink(Path.Combine(Repo, "a"), Path.Combine(Repo, "b"))) return;
        TryLink(Path.Combine(Repo, "b"), Path.Combine(Repo, "a"));

        var resolve = Task.Run(() => RealPaths.Resolve(Path.Combine(Repo, "a", "x")));

        Assert.True(resolve.Wait(TimeSpan.FromSeconds(5)));
    }

    [Fact]
    public void A_missing_tail_is_appended_to_the_resolved_prefix()
    {
        if (!TryLink(Path.Combine(Repo, "sub"), Path.Combine(Outside, "dir"))) return;

        var resolved = RealPaths.Resolve(Path.Combine(Repo, "sub", "new", "file.txt"));

        Assert.Equal(Path.Combine(RealPaths.Resolve(Path.Combine(Outside, "dir")), "new", "file.txt"), resolved);
    }

    private static string Run(string file, params string[] args)
    {
        var info = new ProcessStartInfo(file) { RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var arg in args) info.ArgumentList.Add(arg);
        using var process = Process.Start(info)!;
        var output = process.StandardOutput.ReadToEnd();
        process.WaitForExit();
        return output;
    }
}
