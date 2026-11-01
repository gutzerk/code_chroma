using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

namespace CodeChroma.Shell.App;

public static class Dialogs
{
    public static Task ShowMessageAsync(Window owner, string title, string message, string? detail = null)
    {
        var panel = new StackPanel { Margin = new Thickness(20), Spacing = 10, MinWidth = 320 };
        panel.Children.Add(new TextBlock { Text = message, FontWeight = FontWeight.SemiBold, FontSize = 16, TextWrapping = TextWrapping.Wrap });
        if (detail is not null) panel.Children.Add(new TextBlock { Text = detail, TextWrapping = TextWrapping.Wrap, MaxWidth = 480 });
        return ShowPanelAsync(owner, title, panel, "OK");
    }

    /// <summary>Shows a modal window around <paramref name="panel"/> with a trailing default button that closes it.</summary>
    private static Task ShowPanelAsync(Window owner, string title, StackPanel panel, string okText)
    {
        var ok = new Button { Content = okText, HorizontalAlignment = HorizontalAlignment.Right, IsDefault = true };
        panel.Children.Add(ok);
        var window = new Window { Title = title, Content = panel, SizeToContent = SizeToContent.WidthAndHeight, CanResize = false, WindowStartupLocation = WindowStartupLocation.CenterOwner };
        ok.Click += (_, _) => window.Close();
        return window.ShowDialog(owner);
    }

    /// <summary>Non-dismissable busy window shown while an update downloads; dispose to close it.</summary>
    public static IDisposable ShowProgress(Window owner, string title, string message)
    {
        var bar = new ProgressBar { IsIndeterminate = true, MinWidth = 320 };
        var panel = new StackPanel { Margin = new Thickness(20), Spacing = 12 };
        panel.Children.Add(new TextBlock { Text = message, FontWeight = FontWeight.SemiBold, FontSize = 16, TextWrapping = TextWrapping.Wrap, MaxWidth = 480 });
        panel.Children.Add(bar);
        var window = new Window { Title = title, Content = panel, SizeToContent = SizeToContent.WidthAndHeight, CanResize = false, ShowInTaskbar = false, WindowStartupLocation = WindowStartupLocation.CenterOwner };
        window.Closing += (_, e) => { if (!e.IsProgrammatic) e.Cancel = true; };
        window.Show(owner);
        return new ProgressHandle(window);
    }

    private sealed class ProgressHandle(Window window) : IDisposable
    {
        public void Dispose() => window.Close();
    }

    /// <summary>Post-update report: a coloured status chip, headline, what happened, any detail, and a Continue button.</summary>
    public static Task ShowInstallResultAsync(Window owner, string version, string result, string? detail)
    {
        const string retryHint = "Retry from Help, Check for Updates. If it keeps happening, use Report an issue and include the details below.";
        var (chip, accent, headline, explanation, next) = result switch
        {
            "updated" => ("UPDATED", "#4cc38a", $"CodeChroma is now on {version}", "The update installed and the new version started cleanly.", "Release notes for this version are on the project's GitHub releases page."),
            "rolled-back" => ("ROLLED BACK", "#f0b44c", $"Update to {version} was rolled back", "The new version exited during startup, so the previous version was restored.", retryHint),
            _ => ("FAILED", "#ee6b6b", $"Update to {version} failed", "The previous version is still installed.", retryHint),
        };
        var accentColor = Color.Parse(accent);
        var panel = new StackPanel { Margin = new Thickness(24), Spacing = 12, MinWidth = 380, MaxWidth = 520 };
        panel.Children.Add(new Border
        {
            Background = new SolidColorBrush(accentColor, 0.18),
            CornerRadius = new CornerRadius(10),
            Padding = new Thickness(10, 3),
            HorizontalAlignment = HorizontalAlignment.Left,
            Child = new TextBlock { Text = chip, FontSize = 11, FontWeight = FontWeight.Bold, Foreground = new SolidColorBrush(accentColor) },
        });
        panel.Children.Add(new TextBlock { Text = headline, FontWeight = FontWeight.SemiBold, FontSize = 18, TextWrapping = TextWrapping.Wrap });
        panel.Children.Add(new TextBlock { Text = explanation, TextWrapping = TextWrapping.Wrap });
        if (!string.IsNullOrWhiteSpace(detail) && detail != "ok")
        {
            panel.Children.Add(new Border
            {
                Background = new SolidColorBrush(Color.Parse("#212736")),
                CornerRadius = new CornerRadius(6),
                Padding = new Thickness(10),
                Child = new ScrollViewer { MaxHeight = 200, Content = new TextBlock { Text = detail, FontFamily = new FontFamily("Consolas,Menlo,monospace"), FontSize = 12, TextWrapping = TextWrapping.Wrap } },
            });
        }
        panel.Children.Add(new TextBlock { Text = next, TextWrapping = TextWrapping.Wrap, Opacity = 0.7 });
        return ShowPanelAsync(owner, "CodeChroma update", panel, "Continue");
    }

    public static async Task<bool> ConfirmAsync(Window owner, string title, string message, string detail, string yes, string no)
    {
        var accepted = false;
        var yesButton = new Button { Content = yes, IsDefault = true };
        var noButton = new Button { Content = no };
        var panel = new StackPanel { Margin = new Thickness(20), Spacing = 10, MinWidth = 320 };
        panel.Children.Add(new TextBlock { Text = message, FontWeight = FontWeight.SemiBold, FontSize = 16, TextWrapping = TextWrapping.Wrap });
        panel.Children.Add(new TextBlock { Text = detail, TextWrapping = TextWrapping.Wrap, MaxWidth = 480 });
        panel.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right, Children = { yesButton, noButton } });
        var window = new Window { Title = title, Content = panel, SizeToContent = SizeToContent.WidthAndHeight, CanResize = false, WindowStartupLocation = WindowStartupLocation.CenterOwner };
        yesButton.Click += (_, _) => { accepted = true; window.Close(); };
        noButton.Click += (_, _) => window.Close();
        await window.ShowDialog(owner);
        return accepted;
    }

    public enum UpdateChoice { Later, Install, Skip }

    /// <summary>Update prompt: rendered release notes in a scroll area capped to the owner window, with Install / Skip this version / Later.</summary>
    public static async Task<UpdateChoice> ShowUpdateAsync(Window owner, string version, string? notice, string? notes)
    {
        var choice = UpdateChoice.Later;
        var install = new Button { Content = "Install", IsDefault = true };
        var skip = new Button { Content = "Skip this version" };
        var later = new Button { Content = "Later", IsCancel = true };
        var body = new StackPanel { Spacing = 6 };
        if (!string.IsNullOrWhiteSpace(notice)) body.Children.Add(new TextBlock { Text = notice, TextWrapping = TextWrapping.Wrap, Opacity = 0.7 });
        foreach (var block in MarkdownText.Render(notes)) body.Children.Add(block);
        var header = new TextBlock { Text = $"CodeChroma {version} is available", FontWeight = FontWeight.SemiBold, FontSize = 16, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 0, 0, 10) };
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 12, 0, 0), Children = { install, skip, later } };
        var scroll = new ScrollViewer { Content = body, VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto, HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled };
        var grid = new Grid { Margin = new Thickness(20), RowDefinitions = new RowDefinitions("Auto,*,Auto") };
        Grid.SetRow(scroll, 1);
        Grid.SetRow(buttons, 2);
        grid.Children.Add(header);
        grid.Children.Add(scroll);
        grid.Children.Add(buttons);
        var window = new Window
        {
            Title = "Update available",
            Content = grid,
            Width = Math.Min(560, Math.Max(320, owner.Bounds.Width * 0.9)),
            SizeToContent = SizeToContent.Height,
            MaxHeight = Math.Max(240, owner.Bounds.Height * 0.85),
            CanResize = false,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
        };
        install.Click += (_, _) => { choice = UpdateChoice.Install; window.Close(); };
        skip.Click += (_, _) => { choice = UpdateChoice.Skip; window.Close(); };
        later.Click += (_, _) => window.Close();
        await window.ShowDialog(owner);
        return choice;
    }

    public static Task ShowAboutAsync(Window owner, string version)
    {
        var about = AppInfo.About(version);
        return ShowMessageAsync(owner, about.Title, about.Message, about.Detail);
    }
}
