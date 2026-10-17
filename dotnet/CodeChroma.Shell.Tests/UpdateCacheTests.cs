using CodeChroma.Shell.Tests.Support;

namespace CodeChroma.Shell.Tests;

public class UpdateCacheTests
{
    [Fact]
    public void Persists_and_reads_the_latest_version_in_the_electron_file_format()
    {
        using var temp = new TempDir();
        var cache = new FileUpdateCache(FileUpdateCache.PathIn(temp.Path));

        cache.Write("v2.0.0");

        Assert.Equal("v2.0.0", cache.Read());
        Assert.Equal("""{"latestVersion":"v2.0.0"}""", File.ReadAllText(FileUpdateCache.PathIn(temp.Path)));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("{not json")]
    [InlineData("""{"latestVersion":"not-a-version"}""")]
    [InlineData("""{"latestVersion":5}""")]
    [InlineData("[]")]
    public void Missing_malformed_or_invalid_files_read_as_nothing(string? content)
    {
        using var temp = new TempDir();
        var path = FileUpdateCache.PathIn(temp.Path);
        if (content is not null) File.WriteAllText(path, content);

        Assert.Null(new FileUpdateCache(path).Read());
    }
}
