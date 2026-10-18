using CodeChroma.Bridge;
using Xunit;

namespace CodeChroma.Bridge.Tests;

public class BridgeCliTests
{
    [Fact]
    public void ParsesRepoPathAndPortAndKeepsTheRest()
    {
        var cli = BridgeCli.Parse(["--repo-path", "C:\r", "--port", "5123", "--urls", "x"]);

        Assert.Equal("C:\r", cli.RepoPath);
        Assert.Equal(5123, cli.Port);
        Assert.Equal(["--urls", "x"], cli.Remaining);
    }

    [Fact]
    public void NoArgumentsLeavesEverythingNull()
    {
        var cli = BridgeCli.Parse([]);

        Assert.Null(cli.RepoPath);
        Assert.Null(cli.Port);
    }
}
