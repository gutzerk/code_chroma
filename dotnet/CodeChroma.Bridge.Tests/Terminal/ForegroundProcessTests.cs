using CodeChroma.Bridge.Terminal;

namespace CodeChroma.Bridge.Tests.Terminal;

public class ForegroundProcessTests
{
    private static Func<IReadOnlyList<string>, string?> Ps(string group, string command) =>
        args => args.Contains("tpgid=") ? group + "\n" : command + "\n";

    [Fact]
    public void Resolve_names_the_foreground_group_command()
    {
        var ps = Ps("4321", "/usr/bin/vim");

        var name = ForegroundProcess.Resolve(100, ps);

        Assert.Equal("vim", name);
    }

    [Theory]
    [InlineData("-1")]
    [InlineData("")]
    [InlineData("junk")]
    public void Resolve_is_null_when_no_foreground_group_is_reported(string group)
    {
        var ps = Ps(group, "vim");

        var name = ForegroundProcess.Resolve(100, ps);

        Assert.Null(name);
    }

    [Fact]
    public void Resolve_is_null_when_ps_fails()
    {
        Func<IReadOnlyList<string>, string?> ps = _ => null;

        var name = ForegroundProcess.Resolve(100, ps);

        Assert.Null(name);
    }

    [Fact]
    public async Task Current_refreshes_off_thread_and_caches()
    {
        var calls = 0;
        var probe = new ForegroundProcess(100, args => { Interlocked.Increment(ref calls); return args.Contains("tpgid=") ? "7" : "vim"; }, cacheSeconds: 60);
        var start = DateTime.UtcNow;

        probe.Current(start);
        await Task.Delay(200);
        var name = probe.Current(start.AddSeconds(1));

        Assert.Equal("vim", name);
        Assert.Equal(2, calls);
    }
}
