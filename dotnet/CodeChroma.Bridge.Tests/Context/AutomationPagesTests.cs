using CodeChroma.Bridge.Context;

namespace CodeChroma.Bridge.Tests.Context;

public class AutomationPagesTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), $"auto-{Guid.NewGuid():N}");

    public AutomationPagesTests()
    {
        Directory.CreateDirectory(Path.Combine(_root, ".github", "workflows"));
        Directory.CreateDirectory(Path.Combine(_root, "node_modules", "pkg"));
        Directory.CreateDirectory(Path.Combine(_root, "scripts"));
        File.WriteAllText(Path.Combine(_root, ".github", "workflows", "promote.yml"),
            "name: Promote release\non:\n  workflow_run:\n    workflows: [Publish]\njobs:\n  candidate-guard:\n    runs-on: ubuntu-latest\n  promote-stable:\n    runs-on: ubuntu-latest\n");
        File.WriteAllText(Path.Combine(_root, "scripts", "ecr-channel.sh"),
            "#!/usr/bin/env bash\n# Moves the release channel tag between registries\nset -e\nmove_channel() {\n  echo hi\n}\nverify() {\n  true\n}\n");
        File.WriteAllText(Path.Combine(_root, "node_modules", "pkg", "skip.sh"), "echo skipped\n");
    }

    public void Dispose() => Directory.Delete(_root, recursive: true);

    [Fact]
    public void Workflows_and_scripts_become_pages_with_jobs_and_functions_but_no_node_ids()
    {
        var pages = AutomationPages.Pages(_root);

        Assert.Equal(2, pages.Count);
        var workflow = pages.Single(p => p.Name == "promote.yml");
        Assert.Contains("candidate-guard", workflow.Title);
        Assert.Contains("workflow_run", workflow.Title);
        Assert.All(workflow.Files.Single().Symbols, s => Assert.Equal("", s.NodeId));
        var script = pages.Single(p => p.Name == "ecr-channel.sh");
        Assert.Contains("release channel", script.Title);
        Assert.Equal(["function move_channel", "function verify"], script.Files.Single().Symbols.Select(s => s.Name));
    }

    [Fact]
    public void Dependency_folders_are_skipped_and_the_signature_tracks_edits()
    {
        var before = AutomationPages.Signature(_root);

        File.AppendAllText(Path.Combine(_root, "scripts", "ecr-channel.sh"), "echo more\n");

        Assert.DoesNotContain("skip.sh", string.Join(',', AutomationPages.Discover(_root)));
        Assert.NotEqual(before, AutomationPages.Signature(_root));
    }
}
