using Avalonia.Controls;
using AvaloniaWebView;

namespace CodeChroma.Shell.App;

/// <summary>One tab's content: the canvas WebView (alive while the tab lives) under the launcher shown until a repo is loaded.</summary>
public sealed class TabView : Grid
{
    public WebView Web { get; } = new() { IsVisible = false };

    public LauncherPanel Launcher { get; }

    public TabView(ILauncherHost host)
    {
        Launcher = new LauncherPanel(host);
        Children.Add(Web);
        Children.Add(Launcher);
    }

    public void Navigate(string url)
    {
        Launcher.IsVisible = false;
        Web.IsVisible = true;
        Web.Url = new Uri(url);
    }
}
