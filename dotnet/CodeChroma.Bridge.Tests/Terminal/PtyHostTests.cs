using System.Text;
using CodeChroma.Bridge.Terminal;

namespace CodeChroma.Bridge.Tests.Terminal;

/// <summary>Real child processes on a real pseudo-terminal: ConPTY on Windows, openpty on Unix.</summary>
public class PtyHostTests
{
    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(20);

    private static string[] Shell => OperatingSystem.IsWindows()
        ? [Environment.GetEnvironmentVariable("COMSPEC") ?? "cmd.exe"]
        : ["/bin/sh"];

    private static string Newline => OperatingSystem.IsWindows() ? "\r" : "\n";

    private sealed class Capture
    {
        private readonly StringBuilder _text = new();
        private readonly object _gate = new();
        public void Add(string chunk) { lock (_gate) _text.Append(chunk); }
        public string Text { get { lock (_gate) return _text.ToString(); } }

        public async Task<bool> WaitFor(string needle, TimeSpan? timeout = null)
        {
            var deadline = DateTime.UtcNow + (timeout ?? Patience);
            while (DateTime.UtcNow < deadline)
            {
                if (Text.Contains(needle, StringComparison.Ordinal)) return true;
                await Task.Delay(50);
            }
            return Text.Contains(needle, StringComparison.Ordinal);
        }
    }

    private static PtyHost Spawn(Capture capture, Action? onExit = null, string[]? argv = null, int rows = 24, int cols = 80) =>
        PtyHost.Start(new PtyLaunch(argv ?? Shell, Directory.GetCurrentDirectory(), Rows: rows, Cols: cols), capture.Add, onExit ?? (() => { }));

    [Fact]
    public async Task Input_written_to_a_shell_comes_back_as_output()
    {
        var capture = new Capture();
        using var host = Spawn(capture);

        host.Write("echo codechroma-marker-" + "42" + Newline);

        Assert.True(await capture.WaitFor("codechroma-marker-42"), capture.Text);
    }

    [Fact]
    public async Task The_shell_stays_alive_well_past_the_old_twenty_millisecond_death()
    {
        var capture = new Capture();
        var exited = new TaskCompletionSource();
        using var host = Spawn(capture, () => exited.TrySetResult());

        await Task.Delay(1500);
        host.Write("echo still-here" + Newline);

        Assert.False(exited.Task.IsCompleted);
        Assert.True(host.IsAlive);
        Assert.True(await capture.WaitFor("still-here"), capture.Text);
    }

    [Fact]
    public async Task Binary_input_reaches_the_child_unchanged()
    {
        var capture = new Capture();
        using var host = Spawn(capture);

        host.WriteBytes(Encoding.UTF8.GetBytes("echo raw-bytes-ok" + Newline));

        Assert.True(await capture.WaitFor("raw-bytes-ok"), capture.Text);
    }

    [Fact]
    public async Task Utf8_output_survives_the_chunk_boundary()
    {
        var capture = new Capture();
        using var host = Spawn(capture);

        host.Write("echo café-✓" + Newline);

        Assert.True(await capture.WaitFor("café-✓"), capture.Text);
    }

    [Fact]
    public async Task Resizing_changes_what_the_child_sees()
    {
        var capture = new Capture();
        using var host = Spawn(capture, rows: 24, cols: 80);
        var probe = OperatingSystem.IsWindows() ? "mode con" : "stty size";

        host.Resize(31, 117);
        await Task.Delay(300);
        host.Write(probe + Newline);

        var seen = OperatingSystem.IsWindows() ? "117" : "31 117";
        Assert.True(await capture.WaitFor(seen), capture.Text);
        Assert.Equal((31, 117), host.LastSize);
    }

    [Fact]
    public async Task A_child_that_exits_fires_the_exit_callback_with_its_code()
    {
        var capture = new Capture();
        var exited = new TaskCompletionSource();
        using var host = Spawn(capture, () => exited.TrySetResult());

        host.Write("exit 3" + Newline);

        Assert.Same(exited.Task, await Task.WhenAny(exited.Task, Task.Delay(Patience)));
        Assert.Equal(3, host.ExitCode);
        Assert.False(host.IsAlive);
    }

    [Fact]
    public async Task Close_kills_the_child_and_reports_exit()
    {
        var capture = new Capture();
        var exited = new TaskCompletionSource();
        var host = Spawn(capture, () => exited.TrySetResult());
        await Task.Delay(500);

        host.Close();

        Assert.Same(exited.Task, await Task.WhenAny(exited.Task, Task.Delay(Patience)));
        Assert.False(host.IsAlive);
        host.Dispose();
    }

    [Fact]
    public void A_missing_executable_throws_instead_of_hanging()
    {
        var capture = new Capture();

        Assert.ThrowsAny<Exception>(() => Spawn(capture, argv: ["definitely-not-a-real-binary-xyz"]));
    }

    [Fact]
    public async Task Environment_overrides_reach_the_child()
    {
        var capture = new Capture();
        var launch = new PtyLaunch(Shell, Directory.GetCurrentDirectory(), Env: new Dictionary<string, string> { ["CC_PROBE"] = "probe-value-7" });
        using var host = PtyHost.Start(launch, capture.Add, () => { });

        host.Write((OperatingSystem.IsWindows() ? "echo %CC_PROBE%" : "echo $CC_PROBE") + Newline);

        Assert.True(await capture.WaitFor("probe-value-7"), capture.Text);
    }

    [Fact]
    public async Task Terminal_variables_win_over_the_launch_environment()
    {
        var capture = new Capture();
        var launch = new PtyLaunch(Shell, Directory.GetCurrentDirectory(), Env: new Dictionary<string, string> { ["TERM"] = "dumb" });
        using var host = PtyHost.Start(launch, capture.Add, () => { });

        host.Write((OperatingSystem.IsWindows() ? "echo T=%TERM%=" : "echo T=$TERM=") + Newline);

        Assert.True(await capture.WaitFor("T=xterm-256color="), capture.Text);
    }

    [Fact]
    public async Task Lang_is_not_injected_over_a_launch_environment_that_sets_lc_all()
    {
        var capture = new Capture();
        var launch = new PtyLaunch(Shell, Directory.GetCurrentDirectory(), Env: new Dictionary<string, string> { ["LC_ALL"] = "C.UTF-8", ["LANG"] = "" });
        using var host = PtyHost.Start(launch, capture.Add, () => { });

        host.Write((OperatingSystem.IsWindows() ? "echo L=%LANG%=" : "echo L=$LANG=") + Newline);

        Assert.True(await capture.WaitFor("L=") && !capture.Text.Contains("L=en_US.UTF-8="), capture.Text);
    }
}
