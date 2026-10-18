using CodeChroma.Core.Wiki;

namespace CodeChroma.Core.Tests.Wiki;

public sealed class WikiTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "cc-wiki-" + Guid.NewGuid().ToString("N"));

    public WikiTests()
    {
        CopyDir(Path.Combine(Fixtures.FixturesDir, "sample_repo"), _root);
    }

    public void Dispose()
    {
        try { Directory.Delete(_root, true); } catch (IOException) { }
    }

    private string WikiDir => Path.Combine(_root, ".codechroma", "wiki");

    private static void CopyDir(string from, string to)
    {
        Directory.CreateDirectory(to);
        foreach (var file in Directory.GetFiles(from)) File.Copy(file, Path.Combine(to, Path.GetFileName(file)));
        foreach (var dir in Directory.GetDirectories(from)) CopyDir(dir, Path.Combine(to, Path.GetFileName(dir)));
    }

    [Fact]
    public void Generate_WritesTheRootFolderAndFilePages()
    {
        var graph = Fixtures.GraphOf("sample_repo");

        var result = WikiGenerator.Generate(graph, _root, WikiDir);

        Assert.Contains("- [shared](files/shared/index.md)", File.ReadAllText(Path.Combine(WikiDir, "index.md")));
        Assert.Equal(
            "# shared/text_utils.py\n\nSmall text helpers shared across services.\n\n## Functions\n\n- `slugify` — Lowercase and hyphenate text into a URL-safe slug.\n",
            File.ReadAllText(Path.Combine(WikiDir, "files", "shared", "text_utils.md")));
        Assert.True(File.Exists(result.GapJsonPath));
    }

    [Fact]
    public void ADocstringlessPythonFunction_IsReportedAsAGap()
    {
        var module = Sym.Module("a.py");
        var graph = Sym.GraphFrom([new FileSymbols("a.py", [module, Sym.Func("a.py", "bare", module.Id)])]);

        var result = WikiGenerator.Generate(graph, _root, WikiDir);

        Assert.Equal(2, result.UndocumentedCount);
        Assert.Contains("function `bare`", File.ReadAllText(result.GapReportPath));
    }

    [Fact]
    public void AFolderPastTheCap_IsPaginatedIntoSubIndexPages()
    {
        var files = Enumerable.Range(0, 5).Select(i => $"big/f{i}.py").Select(p => new FileSymbols(p, [Sym.Module(p)])).ToList();
        var graph = Sym.GraphFrom(files);

        WikiGenerator.Generate(graph, _root, WikiDir, cap: 2);

        var index = File.ReadAllText(Path.Combine(WikiDir, "files", "big", "index.md"));
        Assert.Contains("[part 1](sub_index_1.md)", index);
        Assert.Contains("[part 3](sub_index_3.md)", index);
        Assert.False(File.Exists(Path.Combine(WikiDir, "files", "big", "sub_index_4.md")));
    }

    [Fact]
    public void ASecondSyncWithNothingChanged_RegeneratesNothing()
    {
        var graph = Fixtures.GraphOf("sample_repo");
        WikiSync.Sync(graph, _root, WikiDir);

        var second = WikiSync.Sync(graph, _root, WikiDir);

        Assert.Empty(second.ChangedPaths);
        Assert.False(second.FullRegeneration);
    }

    [Fact]
    public void AnEditedFile_RegeneratesOnlyItsPageAndItsAncestors()
    {
        var graph = Fixtures.GraphOf("sample_repo");
        WikiSync.Sync(graph, _root, WikiDir);
        File.AppendAllText(Path.Combine(_root, "shared", "text_utils.py"), "\n# touched\n");

        var result = WikiSync.Sync(graph, _root, WikiDir);

        Assert.Equal(["shared/text_utils.py"], result.ChangedPaths);
        Assert.Contains(result.RegeneratedPages, p => p.EndsWith("text_utils.md", StringComparison.Ordinal));
        Assert.DoesNotContain(result.RegeneratedPages, p => p.Contains("billing", StringComparison.Ordinal));
    }

    [Fact]
    public void ADeletedFile_IsDroppedFromTheNextSync()
    {
        var graph = Fixtures.GraphOf("sample_repo");
        WikiSync.Sync(graph, _root, WikiDir);
        File.Delete(Path.Combine(_root, "shared", "text_utils.py"));

        var result = WikiSync.Sync(graph, _root, WikiDir);

        Assert.Equal(["shared/text_utils.py"], result.ChangedPaths);
    }

    [Theory]
    [InlineData("src/config.py", "src/config.md")]
    [InlineData("a/b.test.ts", "a/b.test.md")]
    [InlineData(".gitignore", ".gitignore.md")]
    [InlineData("Makefile", "Makefile.md")]
    public void FilePageRelativePath_SwapsTheLastSuffix(string input, string expected) =>
        Assert.Equal(expected, WikiGenerator.FilePageRelativePath(input));
}
