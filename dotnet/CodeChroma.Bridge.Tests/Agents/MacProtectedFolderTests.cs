using CodeChroma.Bridge.Agents;

namespace CodeChroma.Bridge.Tests.Agents;

public class MacProtectedFolderTests
{
    [Theory]
    [InlineData("/Users/me/Music", true)]
    [InlineData("/Users/me/Pictures/", true)]
    [InlineData("/Users/me/Movies", true)]
    [InlineData("/Users/me/Library", true)]
    [InlineData("/Users/me/code/Music", false)]
    [InlineData("/Users/me/src", false)]
    public void Home_media_folders_are_protected_on_macos(string path, bool expected)
    {
        var result = AgentBootstrap.IsMacProtectedFolder(path, "/Users/me", isMac: true);

        Assert.Equal(expected, result);
    }

    [Fact]
    public void Nothing_is_protected_off_macos()
    {
        var result = AgentBootstrap.IsMacProtectedFolder("/Users/me/Music", "/Users/me", isMac: false);

        Assert.False(result);
    }
}
