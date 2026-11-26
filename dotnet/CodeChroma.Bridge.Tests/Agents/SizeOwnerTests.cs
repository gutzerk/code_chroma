using CodeChroma.Bridge.Agents;
using CodeChroma.Bridge.Terminal;
using CodeChroma.Bridge.Tests.Support;
using static CodeChroma.Bridge.Tests.Support.FakeCliHarness;

namespace CodeChroma.Bridge.Tests.Agents;

/// <summary>Two windows on one agent: the PTY follows only the window the user works in, so the CLI is not made to redraw at each width.</summary>
[Collection("Session ownership")]
public sealed class SizeOwnerTests : IDisposable
{
    private readonly FakeCliHarness _cli = new();
    private readonly GitSandbox _repo = new();
    private readonly AgentSession _session;

    public SizeOwnerTests()
    {
        _cli.Script(Hang());
        _session = new AgentSession("agent", new PtyLaunch([_cli.ExePath], _repo.Root));
    }

    public void Dispose()
    {
        _session.Dispose();
        _repo.Dispose();
        _cli.Dispose();
    }

    [Fact]
    public void A_window_that_does_not_own_the_size_cannot_resize_the_pty()
    {
        var first = _session.Attach();
        var second = _session.Attach();
        _session.Resize(first, 30, 100);
        _session.Resize(second, 30, 60);

        _session.Resize(first, 30, 120);

        Assert.Equal(60, _session.Screen.Cols);
    }

    [Fact]
    public void Typing_in_a_window_gives_the_pty_that_window_s_last_size()
    {
        var first = _session.Attach();
        var second = _session.Attach();
        _session.Resize(first, 30, 100);
        _session.Resize(second, 30, 60);
        _session.Resize(first, 30, 120);

        _session.Input(first, "x");

        Assert.Equal(120, _session.Screen.Cols);
    }

    [Fact]
    public void Closing_the_owning_window_hands_the_size_to_a_remaining_one()
    {
        var first = _session.Attach();
        var second = _session.Attach();
        _session.Resize(first, 30, 100);
        _session.Resize(second, 30, 60);

        _session.Detach(second);

        Assert.Equal(100, _session.Screen.Cols);
    }

    [Fact]
    public void A_window_that_never_reported_a_size_cannot_claim_the_pty()
    {
        var first = _session.Attach();
        var silent = _session.Attach();
        _session.Resize(first, 30, 100);

        _session.Input(silent, "x");

        Assert.Equal(100, _session.Screen.Cols);
    }

    [Fact]
    public void Attaching_with_a_size_takes_the_pty_over_at_that_size()
    {
        var first = _session.Attach();
        _session.Resize(first, 30, 100);

        _session.Attach((40, 140));

        Assert.Equal((40, 140), (_session.Screen.Rows, _session.Screen.Cols));
    }

    [Fact]
    public void Attaching_with_a_size_paints_once_and_its_first_resize_does_not_redraw_again()
    {
        var window = _session.Attach((30, 90));
        var seeded = Drain(window);

        _session.Resize(window, 30, 90);

        Assert.Single(seeded);
        Assert.StartsWith("\u001b[?25l", seeded[0]);
        Assert.Empty(Drain(window));
    }

    [Fact]
    public void Attaching_without_a_size_redraws_again_on_the_first_resize()
    {
        var window = _session.Attach();
        Drain(window);

        _session.Resize(window, 30, 90);

        Assert.Contains(Drain(window), frame => frame.StartsWith("\u001b[?25l", StringComparison.Ordinal));
    }

    [Fact]
    public void Attached_windows_counts_each_attach_until_its_detach()
    {
        var before = _session.AttachedWindows;

        var first = _session.Attach();
        var second = _session.Attach((30, 90));
        var both = _session.AttachedWindows;
        _session.Detach(first);
        var one = _session.AttachedWindows;
        _session.Detach(second);

        Assert.Equal((0, 2, 1, 0), (before, both, one, _session.AttachedWindows));
    }

    private static List<string> Drain(AgentConsumer window)
    {
        var frames = new List<string>();
        while (window.Output.TryRead(out var frame)) frames.Add(frame);
        return frames;
    }
}
