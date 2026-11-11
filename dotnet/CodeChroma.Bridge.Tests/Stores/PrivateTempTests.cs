using CodeChroma.Bridge.Stores;

namespace CodeChroma.Bridge.Tests.Stores;

public sealed class PrivateTempTests : IDisposable
{
    private readonly string _parent = Directory.CreateTempSubdirectory("cc-sweep-").FullName;

    public void Dispose()
    {
        try { Directory.Delete(_parent, recursive: true); } catch (IOException) { }
    }

    private string Dir(string name, TimeSpan age)
    {
        var dir = Directory.CreateDirectory(Path.Combine(_parent, name)).FullName;
        Directory.SetLastWriteTimeUtc(dir, DateTime.UtcNow - age);
        return dir;
    }

    [Fact]
    public void A_sweep_removes_only_old_dirs_of_its_prefix_and_keeps_its_own()
    {
        var old = Dir("codechroma-agents-old", TimeSpan.FromDays(8));
        var fresh = Dir("codechroma-agents-fresh", TimeSpan.FromDays(1));
        var own = Dir("codechroma-agents-own", TimeSpan.FromDays(30));
        var other = Dir("codechroma-mcp-old", TimeSpan.FromDays(30));

        PrivateTemp.Sweep(_parent, "codechroma-agents-", own, DateTime.UtcNow);

        Assert.False(Directory.Exists(old));
        Assert.True(Directory.Exists(fresh));
        Assert.True(Directory.Exists(own));
        Assert.True(Directory.Exists(other));
    }
}
