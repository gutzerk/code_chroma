using Avalonia;
using Avalonia.WebView.Desktop;

namespace CodeChroma.Shell.App;

internal static class Program
{
    public static string[] Args { get; private set; } = [];

    [STAThread]
    public static void Main(string[] args)
    {
        Args = args;
        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<App>().UsePlatformDetect().UseDesktopWebView();
}
