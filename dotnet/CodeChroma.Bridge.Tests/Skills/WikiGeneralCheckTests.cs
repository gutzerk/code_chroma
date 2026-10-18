using CodeChroma.Bridge.Skills;

namespace CodeChroma.Bridge.Tests.Skills;

public sealed class WikiGeneralCheckTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "cc-wgcheck-" + Guid.NewGuid().ToString("N")[..8]);

    public WikiGeneralCheckTests() => Directory.CreateDirectory(Path.Combine(_dir, "c2"));

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch (IOException) { }
    }

    private void Write(string relative, string text)
    {
        var path = Path.Combine(_dir, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, text);
    }

    private void GoodTree(string componentPage = "# Auth\n\nText.\n\n## Elements\n\n- **Login** — Logs in.\n  - File: `app/a.py`\n")
    {
        Write("manifest.json", """
            {"containers":[{"id":"core","name":"Core","path":"c2/core.md"}],
             "components":[{"id":"auth","name":"Auth","container":"core","path":"c3/auth.md"}],
             "edges":[{"from":"auth","to":"other","count":2}]}
            """);
        Write("index.md", "# Repo\n\n- [Core](c2/core.md) — Core.\n");
        Write("c2/core.md", "# Core\n\n- [Auth](../c3/auth.md) — Auth.\n");
        Write("c3/auth.md", componentPage);
    }

    private static ISet<string> NoGaps(IReadOnlyList<string> _) => new HashSet<string>();

    [Fact]
    public void A_consistent_tree_passes()
    {
        GoodTree();

        var (code, lines) = WikiGeneralCheck.Run(_dir, NoGaps);

        Assert.Equal(0, code);
        Assert.Equal("OK: 3 page(s), 1 code reference(s) resolved", lines[^1]);
    }

    [Fact]
    public void A_path_the_plain_wiki_has_no_page_for_is_hallucinated()
    {
        GoodTree();

        var (code, lines) = WikiGeneralCheck.Run(_dir, paths => paths.ToHashSet());

        Assert.Equal(1, code);
        Assert.Contains("HALLUCINATED 'app/a.py' matches no page in .codechroma/wiki/", lines);
    }

    [Fact]
    public void A_connects_line_without_a_matching_edge_fails()
    {
        GoodTree("# Auth\n\nText.\n\n## Elements\n\n## Connections\n\n- Connects: `ghost`\n");

        var (code, lines) = WikiGeneralCheck.Run(_dir, NoGaps);

        Assert.Equal(1, code);
        Assert.Contains("CONNECTS-INVALID 'auth' claims a connection to 'ghost', which has no matching edges[] entry", lines);
    }

    [Fact]
    public void A_component_naming_a_missing_container_and_an_empty_container_both_fail()
    {
        Write("manifest.json", """
            {"containers":[{"id":"core","path":"c2/core.md"},{"id":"idle","path":"c2/core.md"}],
             "components":[{"id":"auth","container":"nowhere","path":"c3/auth.md"}]}
            """);
        Write("index.md", "# Repo\n");
        Write("c2/core.md", "# Core\n");
        Write("c3/auth.md", "# Auth\n");

        var (code, lines) = WikiGeneralCheck.Run(_dir, NoGaps);

        Assert.Equal(1, code);
        Assert.Contains("DANGLING component 'auth' names container 'nowhere', which does not exist", lines);
        Assert.Contains("EMPTY-CONTAINER 'core' has no components", lines);
    }

    [Fact]
    public void A_missing_page_fails()
    {
        GoodTree();
        File.Delete(Path.Combine(_dir, "c3", "auth.md"));
        Write("c2/core.md", "# Core\n");

        var (code, lines) = WikiGeneralCheck.Run(_dir, NoGaps);

        Assert.Equal(1, code);
        Assert.Contains(lines, l => l.StartsWith("MISSING-PAGE c3 page "));
    }

    [Fact]
    public void A_missing_parent_link_alone_is_advisory_on_a_passing_run()
    {
        GoodTree();
        Write("c2/core.md", "# Core\n");

        var (code, lines) = WikiGeneralCheck.Run(_dir, NoGaps);

        Assert.Equal(0, code);
        Assert.Equal("LINK-MISSING container 'core' page never links to c3/auth.md", lines[0]);
    }

    [Fact]
    public void A_missing_or_malformed_manifest_is_an_error_not_a_failure()
    {
        var (missingCode, _) = WikiGeneralCheck.Run(_dir, NoGaps);
        Write("manifest.json", "{not json");

        var (brokenCode, lines) = WikiGeneralCheck.Run(_dir, NoGaps);

        Assert.Equal(2, missingCode);
        Assert.Equal(2, brokenCode);
        Assert.Contains("is not valid JSON", lines[0]);
    }

    [Fact]
    public void A_failing_gap_lookup_is_an_error()
    {
        GoodTree();

        var (code, lines) = WikiGeneralCheck.Run(_dir, _ => throw new IOException("bridge down"));

        Assert.Equal(2, code);
        Assert.Equal("ERROR could not verify wiki-context references: bridge down", lines[0]);
    }
}
