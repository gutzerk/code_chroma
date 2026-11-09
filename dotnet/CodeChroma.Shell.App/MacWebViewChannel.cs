using System.Diagnostics;
using System.Runtime.CompilerServices;
using Avalonia.WebView.MacCatalyst.Core;
using AvaloniaWebView;

namespace CodeChroma.Shell.App;

/// <summary>Unhooks a WebView's macOS "webview" script channel before disposal, since WebView.Avalonia leaves it registered and a late postMessage then null-derefs and aborts the app.</summary>
public static class MacWebViewChannel
{
    private const string HandlerName = "webview";

    /// <summary>No-op off macOS or once the native view is gone; never throws.</summary>
    public static void Detach(WebView web)
    {
        if (!OperatingSystem.IsMacOS()) return;
        try { DetachNative(web); }
        catch (Exception e) { Trace.TraceWarning($"Could not detach the WebView script channel: {e}"); }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void DetachNative(WebView web)
    {
        if (web.PlatformWebView is not MacCatalystWebViewCore { IsDisposed: false, WebView: { } native }) return;
        native.Configuration.UserContentController.RemoveScriptMessageHandler(HandlerName);
    }
}
