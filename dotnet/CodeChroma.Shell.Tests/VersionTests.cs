namespace CodeChroma.Shell.Tests;

public class VersionTests
{
    [Theory]
    [InlineData("1.2.3", "1.10.0", -1)]
    [InlineData("v1.0.0", "1.0.0", 0)]
    [InlineData("1.0.0", "1.0.0-rc.1", 1)]
    [InlineData("1.0.0-beta.10", "1.0.0-beta.2", 1)]
    [InlineData("1.0.0-alpha", "1.0.0-beta", -1)]
    [InlineData("1.0.0-1", "1.0.0-alpha", -1)]
    [InlineData("1.0.0+one", "1.0.0+two", 0)]
    public void Comparison_follows_semver_precedence(string a, string b, int expectedSign)
    {
        var result = SemVer.CompareTags(a, b);

        Assert.Equal(expectedSign, Math.Sign(result));
    }

    [Theory]
    [InlineData("v2.0.0junk")]
    [InlineData("1.0.0garbage")]
    [InlineData("1.0.0-01")]
    [InlineData("1.2")]
    [InlineData("")]
    public void Non_semver_tags_are_rejected(string tag)
    {
        Assert.False(SemVer.TryParse(tag, out _));
        Assert.Throws<FormatException>(() => SemVer.CompareTags(tag, "1.0.0"));
    }

    [Fact]
    public void Prerelease_is_flagged()
    {
        Assert.True(SemVer.TryParse("v3.0.0-beta.1", out var parsed));
        Assert.True(parsed!.IsPrerelease);
    }
}
