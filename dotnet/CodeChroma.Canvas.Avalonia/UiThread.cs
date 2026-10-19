using Avalonia.Threading;

namespace CodeChroma.Canvas.Avalonia;

/// <summary>Runs a store-change handler on the UI thread, since model stores raise Changed from whichever thread finished the work.</summary>
internal static class UiThread
{
    public static void Run(Action action)
    {
        if (Dispatcher.UIThread.CheckAccess()) action();
        else Dispatcher.UIThread.Post(action);
    }
}
