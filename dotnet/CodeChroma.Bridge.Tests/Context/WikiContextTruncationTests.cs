using CodeChroma.Bridge.Wiki;

namespace CodeChroma.Bridge.Tests.Context;

public class WikiContextTruncationTests : IDisposable
{
    private readonly string _wiki = Path.Combine(Path.GetTempPath(), $"wikictx-{Guid.NewGuid():N}");

    public WikiContextTruncationTests()
    {
        Directory.CreateDirectory(Path.Combine(_wiki, "files", "src"));
        File.WriteAllText(Path.Combine(_wiki, "index.md"), "# root\n");
        foreach (var name in new[] { "a", "b" })
            File.WriteAllText(Path.Combine(_wiki, "files", "src", $"{name}.md"), new string('x', 12_000));
    }

    public void Dispose() => Directory.Delete(_wiki, recursive: true);

    [Fact]
    public void A_response_cut_off_by_the_size_cap_names_the_omitted_paths_and_warns()
    {
        var bundle = WikiContext.Build(_wiki, ["src/a.py", "src/b.py"]);
        var json = bundle.ToJson();

        Assert.True(bundle.Truncated);
        Assert.Empty(bundle.Gaps);
        Assert.Equal("src/b.py", Assert.Single(bundle.Omitted!));
        Assert.Contains("request them again", json["warning"]!.GetValue<string>());
        Assert.Equal("src/b.py", json["omitted"]![0]!.GetValue<string>());
    }

    [Fact]
    public void A_response_within_the_cap_has_no_omitted_paths_and_no_warning()
    {
        var bundle = WikiContext.Build(_wiki, ["src/a.py"]);
        var json = bundle.ToJson();

        Assert.False(bundle.Truncated);
        Assert.Empty(json["omitted"]!.AsArray());
        Assert.Null(json["warning"]);
    }
}
