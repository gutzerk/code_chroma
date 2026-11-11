using System.Runtime.InteropServices;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Layout;
using Avalonia.Markup.Xaml;
using Avalonia.Media;

namespace CodeChroma.Shell.App;

public sealed class App : Application
{
    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            var missing = WebViewRuntime.Missing(ShellPlatform.Current.Os, CanLoad);
            desktop.MainWindow = missing.Count == 0 ? new MainWindow(Program.Args) : MissingWebViewWindow(missing);
        }
        base.OnFrameworkInitializationCompleted();
    }

    private static bool CanLoad(string library)
    {
        if (!NativeLibrary.TryLoad(library, out var handle)) return false;
        NativeLibrary.Free(handle);
        return true;
    }

    /// <summary>Shown instead of MainWindow, whose first WebView would block the UI thread forever without these libraries.</summary>
    private static Window MissingWebViewWindow(IReadOnlyList<string> missing)
    {
        var (message, detail) = WebViewRuntime.Advice(missing);
        var panel = new StackPanel { Margin = new Thickness(28), Spacing = 14, MaxWidth = 560, VerticalAlignment = VerticalAlignment.Center };
        panel.Children.Add(new TextBlock { Text = message, FontWeight = FontWeight.SemiBold, FontSize = 18, TextWrapping = TextWrapping.Wrap });
        panel.Children.Add(new SelectableTextBlock { Text = detail, TextWrapping = TextWrapping.Wrap });
        return new Window { Title = "CodeChroma", Width = 640, Height = 360, Content = panel, WindowStartupLocation = WindowStartupLocation.CenterScreen };
    }
}
