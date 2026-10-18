namespace CodeChroma.Bridge.Workspaces;

/// <summary>Fires once after triggers have been quiet for the window, like watchfiles' debounce.</summary>
public sealed class Debouncer : IDisposable
{
    private readonly Timer _timer;
    private readonly TimeSpan _quiet;
    private readonly object _gate = new();
    private bool _disposed;
    private bool _running;
    private bool _again;

    public Debouncer(TimeSpan quiet, Action fire)
    {
        _quiet = quiet;
        _timer = new Timer(_ =>
        {
            lock (_gate)
            {
                if (_disposed) return;
                if (_running) { _again = true; return; }
                _running = true;
            }
            try
            {
                while (true)
                {
                    try { fire(); }
                    catch (Exception) { /* a failing callback must not end live updates */ }
                    lock (_gate)
                    {
                        if (_disposed || !_again) { _running = false; return; }
                        _again = false;
                    }
                }
            }
            finally
            {
                lock (_gate) _running = false;
            }
        });
    }

    public void Trigger()
    {
        lock (_gate)
        {
            if (_disposed) return;
            if (_running) { _again = true; return; }
            try { _timer.Change(_quiet, Timeout.InfiniteTimeSpan); }
            catch (ObjectDisposedException) { }
        }
    }

    public void Dispose()
    {
        lock (_gate) _disposed = true;
        _timer.Dispose();
    }
}
