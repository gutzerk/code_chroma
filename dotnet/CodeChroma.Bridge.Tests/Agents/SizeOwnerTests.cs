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
}
