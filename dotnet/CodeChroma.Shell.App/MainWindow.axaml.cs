using Avalonia.Controls;

namespace CodeChroma.Shell.App;

/// <summary>Thin host over TabModel; the web-canvas WebView per tab is remaining work (see docs/planning).</summary>
public sealed partial class MainWindow : Window
{
    private readonly TabModel tabs = new(() => new object());

    public MainWindow()
    {
        InitializeComponent();
        tabs.NewTab();
        Render();
    }

    private void Render()
    {
        TabStrip.Children.Clear();
        foreach (var tab in tabs.Tabs)
        {
            var id = tab.Id;
            var button = new Button { Content = tab.RepoPath ?? tab.Label ?? tab.WorkspaceId ?? "New tab", IsEnabled = id != tabs.ActiveTab?.Id };
            button.Click += (_, _) => { tabs.SetActive(id); Render(); };
            TabStrip.Children.Add(button);
        }
        var add = new Button { Content = "+" };
        add.Click += (_, _) => { tabs.NewTab(); Render(); };
        TabStrip.Children.Add(add);
        Placeholder.Text = tabs.ActiveTab?.RepoPath ?? "Open a project";
    }
}
