namespace CodeChroma.Bridge.Workspaces;

/// <summary>Fires once after triggers have been quiet for the window, like watchfiles' debounce.</summary>
public sealed class Debouncer : IDisposable
{
    private readonly Timer _timer;
    private readonly TimeSpan _quiet;

    public Debouncer(TimeSpan quiet, Action fire)
    {
        _quiet = quiet;
        _timer = new Timer(_ =>
        {
            try { fire(); }
            catch (Exception) { /* a failing callback must not end live updates */ }
        });
    }

    public void Trigger() => _timer.Change(_quiet, Timeout.InfiniteTimeSpan);

    public void Dispose() => _timer.Dispose();
}
