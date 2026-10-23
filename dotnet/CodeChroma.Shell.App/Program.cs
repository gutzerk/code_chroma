using Avalonia;
using Avalonia.WebView.Desktop;
using Velopack;

namespace CodeChroma.Shell.App;

internal static class Program
{
    public static string[] Args { get; private set; } = [];

    [STAThread]
    public static void Main(string[] args)
    {
        VelopackApp.Build().Run();
        Args = args;
        Environment.SetEnvironmentVariable("codechroma_MODEL_WARMUP", "1");
        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);
    }

    public static AppBuilder BuildAvaloniaApp() => AppBuilder.Configure<App>().UsePlatformDetect().UseDesktopWebView();
}
