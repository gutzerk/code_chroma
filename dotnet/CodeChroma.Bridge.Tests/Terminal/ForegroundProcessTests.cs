using CodeChroma.Bridge.Terminal;

namespace CodeChroma.Bridge.Tests.Terminal;

public class ForegroundProcessTests
{
    private static string? FakePs(string[] args) => args[1] == "tpgid=" ? " 4242\n" : args[3] == "4242" ? "/usr/bin/vim\n" : null;

    [Fact]
    public void The_foreground_group_is_resolved_to_a_base_command_name()
    {
        var probe = new ForegroundProcess(100, FakePs, supported: () => true);

        probe.Name(DateTime.UtcNow);
        probe.Settle();

        Assert.Equal("vim", probe.Name(DateTime.UtcNow));
    }

    [Fact]
    public void An_unsupported_platform_never_probes_and_stays_unknown()
    {
        var calls = 0;
        var probe = new ForegroundProcess(100, args => { calls++; return FakePs(args); }, supported: () => false);

        probe.Name(DateTime.UtcNow);
        probe.Settle();

        Assert.Null(probe.Name(DateTime.UtcNow));
        Assert.Equal(0, calls);
    }

    [Fact]
    public void A_failing_ps_leaves_the_name_unknown()
    {
        var probe = new ForegroundProcess(100, _ => throw new InvalidOperationException("no ps"), supported: () => true);

        probe.Name(DateTime.UtcNow);
        probe.Settle();

        Assert.Null(probe.Name(DateTime.UtcNow));
    }

    [Fact]
    public void Probes_are_cached_within_the_window()
    {
        var calls = 0;
        var probe = new ForegroundProcess(100, args => { calls++; return FakePs(args); }, TimeSpan.FromHours(1), () => true);
        var now = DateTime.UtcNow;

        probe.Name(now);
        probe.Settle();
        probe.Name(now.AddSeconds(5));
        probe.Settle();

        Assert.Equal(2, calls);
    }
}
