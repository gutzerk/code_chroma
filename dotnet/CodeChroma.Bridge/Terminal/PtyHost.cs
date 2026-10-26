using System.Text;
using CodeChroma.Bridge.Stores;
using Porta.Pty;

namespace CodeChroma.Bridge.Terminal;

/// <summary>What to run on a pseudo-terminal: argv, directory, environment overrides and the starting geometry.</summary>
public sealed record PtyLaunch(
    IReadOnlyList<string> Argv,
    string? Cwd = null,
    IReadOnlyDictionary<string, string>? Env = null,
    int Rows = PtyLaunch.DefaultRows,
    int Cols = PtyLaunch.DefaultCols)
{
    public const int DefaultRows = 30;
    public const int DefaultCols = 120;
}

/// <summary>
/// One child on a real pseudo-terminal (ConPTY on Windows, openpty on Unix, via Porta.Pty). Output is decoded as UTF-8
/// across chunk boundaries, input can be text or raw bytes, and the child outlives any socket until Close/Dispose.
/// </summary>
public sealed class PtyHost : IDisposable
{
    private const string DeviceAttributesQuery = "\u001b[c";
    private const string DeviceAttributesReply = "\u001b[?1;0c";
    private const int ReadChunkBytes = 4096;

    private readonly IPtyConnection _pty;
    private readonly Action<string> _onOutput;
    private readonly Action _onExit;
    private readonly Decoder _decoder = new UTF8Encoding(false).GetDecoder();
    private readonly object _writeGate = new();
    private readonly TaskCompletionSource _readerDone = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private int _closed;
    private int _exitReported;
    private bool _answeredDeviceQuery;

    private PtyHost(IPtyConnection pty, Action<string> onOutput, Action onExit, int rows, int cols)
    {
        _pty = pty;
        _onOutput = onOutput;
        _onExit = onExit;
        LastSize = (rows, cols);
    }

    public int Pid => _pty.Pid;

    public (int Rows, int Cols) LastSize { get; private set; }

    public int? ExitCode { get; private set; }

    public bool IsAlive => ExitCode is null && Volatile.Read(ref _closed) == 0 && !_readerDone.Task.IsCompleted;

    /// <summary>Spawns the child; a missing or unlaunchable executable throws instead of yielding a dead session.</summary>
    public static PtyHost Start(PtyLaunch launch, Action<string> onOutput, Action onExit)
    {
        var (app, args) = Resolve(launch.Argv);
        var environment = new Dictionary<string, string>
        {
            ["TERM"] = "xterm-256color",
            ["COLORTERM"] = "truecolor",
            ["FORCE_COLOR"] = "1",
        };
        if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("LC_ALL")) && string.IsNullOrEmpty(Environment.GetEnvironmentVariable("LANG")))
            environment["LANG"] = "en_US.UTF-8";
        foreach (var (key, value) in launch.Env ?? new Dictionary<string, string>()) environment[key] = value;

        var options = new PtyOptions
        {
            Name = "CodeChroma",
            App = app,
            CommandLine = args,
            Cwd = launch.Cwd ?? Directory.GetCurrentDirectory(),
            Rows = launch.Rows,
            Cols = launch.Cols,
            Environment = environment,
        };
        var pty = PtyProvider.SpawnAsync(options, CancellationToken.None).GetAwaiter().GetResult();
        var host = new PtyHost(pty, onOutput, onExit, launch.Rows, launch.Cols);
        pty.ProcessExited += (_, _) => host.OnProcessExited();
        _ = Task.Run(host.ReadLoop);
        return host;
    }

    public void Write(string data) => WriteBytes(Encoding.UTF8.GetBytes(data));

    /// <summary>Raw input that must not be re-encoded: xterm's binary channel (mouse reports).</summary>
    public void WriteBytes(byte[] data)
    {
        if (Volatile.Read(ref _closed) != 0 || data.Length == 0) return;
        try
        {
            lock (_writeGate)
            {
                _pty.WriterStream.Write(data, 0, data.Length);
                _pty.WriterStream.Flush();
            }
        }
        catch (Exception error) when (error is IOException or ObjectDisposedException or InvalidOperationException)
        {
            // the child is gone; the exit callback reports it
        }
    }

    public void Resize(int rows, int cols)
    {
        if (Volatile.Read(ref _closed) != 0 || rows <= 0 || cols <= 0) return;
        LastSize = (rows, cols);
        try { _pty.Resize(cols, rows); }
        catch (Exception error) when (error is IOException or ObjectDisposedException or InvalidOperationException) { }
    }

    /// <summary>Kills the child; the exit callback fires once it has been reaped.</summary>
    public void Close()
    {
        if (Interlocked.Exchange(ref _closed, 1) != 0) return;
        try { _pty.Kill(); }
        catch (Exception error) when (error is IOException or ObjectDisposedException or InvalidOperationException) { }
        ReportExit();
    }

    public void Dispose()
    {
        Close();
        try { _pty.Dispose(); }
        catch (Exception error) when (error is IOException or ObjectDisposedException or InvalidOperationException) { }
    }

    private async Task ReadLoop()
    {
        var buffer = new byte[ReadChunkBytes];
        var chars = new char[Encoding.UTF8.GetMaxCharCount(ReadChunkBytes)];
        try
        {
            while (true)
            {
                var read = await _pty.ReaderStream.ReadAsync(buffer.AsMemory());
                if (read <= 0) break;
                var count = _decoder.GetChars(buffer, 0, read, chars, 0);
                if (count == 0) continue;
                var text = new string(chars, 0, count);
                AnswerDeviceQuery(text);
                _onOutput(text);
            }
        }
        catch (Exception error) when (error is IOException or ObjectDisposedException or InvalidOperationException or OperationCanceledException) { }
        finally
        {
            _readerDone.TrySetResult();
            ReportExit();
        }
    }

    /// <summary>ConPTY withholds all child output until its startup ESC[c query is answered, and no terminal may be attached yet.</summary>
    private void AnswerDeviceQuery(string text)
    {
        if (_answeredDeviceQuery || !text.Contains(DeviceAttributesQuery, StringComparison.Ordinal)) return;
        _answeredDeviceQuery = true;
        Write(DeviceAttributesReply);
    }

    private void OnProcessExited() => ReportExit();

    private void ReportExit()
    {
        if (!TryReapExitCode()) return;
        if (Interlocked.Exchange(ref _exitReported, 1) != 0) return;
        _onExit();
    }

    private bool TryReapExitCode()
    {
        if (ExitCode is not null) return true;
        try
        {
            if (!_pty.WaitForExit(2000)) return false;
            ExitCode = _pty.ExitCode;
        }
        catch (Exception error) when (error is IOException or ObjectDisposedException or InvalidOperationException)
        {
            ExitCode = -1;
        }
        return true;
    }

    /// <summary>The executable path plus its arguments; .cmd/.bat shims go through cmd.exe, which CreateProcess cannot run directly.</summary>
    private static (string App, string[] Args) Resolve(IReadOnlyList<string> argv)
    {
        if (argv.Count == 0 || string.IsNullOrWhiteSpace(argv[0])) throw new ArgumentException("no command to launch", nameof(argv));
        var found = Path.IsPathRooted(argv[0]) && File.Exists(argv[0]) ? argv[0] : CliLocator.Find(argv[0]);
        if (found is null) throw new FileNotFoundException($"'{argv[0]}' was not found on PATH", argv[0]);
        var rest = argv.Skip(1).ToArray();
        if (OperatingSystem.IsWindows() && (found.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase) || found.EndsWith(".bat", StringComparison.OrdinalIgnoreCase)))
        {
            var cmd = Environment.GetEnvironmentVariable("COMSPEC") ?? "cmd.exe";
            return (cmd, ["/c", found, .. rest]);
        }
        return (found, rest);
    }
}
