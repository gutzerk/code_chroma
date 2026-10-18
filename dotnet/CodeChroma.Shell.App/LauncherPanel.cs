using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Primitives;
using Avalonia.Layout;
using Avalonia.Media;

namespace CodeChroma.Shell.App;

/// <summary>What the launcher needs from the window: open a repo, pick a folder, and where recents live.</summary>
public interface ILauncherHost
{
    string RecentsPath { get; }

    string UserDataDir { get; }

    Task OpenRepoAsync(string repoPath, string? workspaceId);

    Task<string?> PickFolderAsync(string title);
}

/// <summary>The open-project screen of an empty tab, laid out like the Electron launcher: tutorial, title, recent panel, open/new buttons.</summary>
public sealed class LauncherPanel : UserControl
{
    private static readonly IBrush Muted = new SolidColorBrush(Color.Parse("#8b93a7"));
    private static readonly IBrush Line = new SolidColorBrush(Color.Parse("#2a3040"));
    private static readonly IBrush PanelBg = new SolidColorBrush(Color.Parse("#191d28"));
    private static readonly IBrush NestedBg = new SolidColorBrush(Color.Parse("#141722"));

    private readonly ILauncherHost host;
    private readonly TextBlock status = new() { TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, MinHeight = 34, Foreground = Muted };
    private readonly StackPanel recents = new();
    private readonly Border recentsPanel;
    private readonly Button openButton = new() { Content = "Open folder…", Classes = { "primary" } };
    private readonly Button tutorialButton = new() { Content = "Tutorial", Classes = { "primary", "tutorial" }, Width = 240, HorizontalContentAlignment = HorizontalAlignment.Center, HorizontalAlignment = HorizontalAlignment.Center };
    private readonly Button newToggle = new() { Content = "New project…" };
    private readonly StackPanel newForm = new() { Spacing = 8, IsVisible = false };
    private readonly TextBox newName = new() { Watermark = "Project name" };
    private readonly TextBlock newLocation = new() { Text = "No location chosen", Foreground = Muted, FontSize = 11, VerticalAlignment = VerticalAlignment.Center, TextTrimming = TextTrimming.CharacterEllipsis };
    private readonly Button newBrowse = new() { Content = "Location…" };
    private readonly Button newCreate = new() { Content = "Create and open", Classes = { "primary" } };
    private string? newParentDir;
    private bool busy;

    public LauncherPanel(ILauncherHost host)
    {
        this.host = host;
        openButton.Click += async (_, _) => { if (!busy && await host.PickFolderAsync("Open repository") is { } path) await OpenAsync(path, null); };
        tutorialButton.Click += async (_, _) => await GuardAsync(async () => await OpenAsync(TutorialProject.Create(host.UserDataDir), null));
        newToggle.Click += (_, _) => newForm.IsVisible = !newForm.IsVisible;
        newBrowse.Click += async (_, _) =>
        {
            if (await host.PickFolderAsync("Where to create the project") is not { } picked) return;
            newParentDir = picked;
            newLocation.Text = picked;
        };
        newCreate.Click += async (_, _) => await GuardAsync(async () =>
        {
            if (newParentDir is null) throw new InvalidOperationException("Choose where to create the project.");
            await OpenAsync(NewProject.Create(newParentDir, newName.Text ?? ""), null);
        });
        newForm.Children.Add(newName);
        newForm.Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { newBrowse, newLocation } });
        newForm.Children.Add(newCreate);
        recentsPanel = new Border
        {
            BorderBrush = Line,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(10),
            Background = PanelBg,
            ClipToBounds = true,
            Child = new StackPanel
            {
                Children =
                {
                    new Border
                    {
                        Padding = new Thickness(14, 10),
                        BorderBrush = Line,
                        BorderThickness = new Thickness(0, 0, 0, 1),
                        Child = new TextBlock { Text = "RECENT", FontSize = 11, LetterSpacing = 1, Foreground = Muted },
                    },
                    recents,
                },
            },
        };

        var column = new StackPanel
        {
            Width = 460,
            Spacing = 24,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center,
            Margin = new Thickness(0, 32),
            Children =
            {
                tutorialButton,
                new StackPanel
                {
                    Spacing = 2,
                    Children =
                    {
                        new TextBlock { Text = "CodeChroma", FontSize = 22, FontWeight = FontWeight.SemiBold, HorizontalAlignment = HorizontalAlignment.Center },
                        new TextBlock { Text = "Open a repository to map it.", Foreground = Muted, HorizontalAlignment = HorizontalAlignment.Center },
                    },
                },
                recentsPanel,
                new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center, Children = { openButton, newToggle } },
                newForm,
                status,
            },
        };
        column.VerticalAlignment = VerticalAlignment.Top;
        var scroller = new ScrollViewer { HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, HorizontalAlignment = HorizontalAlignment.Stretch, VerticalAlignment = VerticalAlignment.Stretch, Content = new Grid { Children = { column } } };
        Content = scroller;
        RenderRecents(RecentRepos.Read(host.RecentsPath));
    }

    public void ShowProgress(string line) =>
        SetStatus(line.StartsWith("analyzing ", StringComparison.Ordinal) ? $"Analyzing {line[10..]}…" : line, false);

    public void ShowError(string message)
    {
        SetBusy(false);
        SetStatus(message, true);
    }

    private async Task OpenAsync(string repoPath, string? workspaceId)
    {
        if (busy) return;
        SetBusy(true);
        SetStatus("Starting…", false);
        await host.OpenRepoAsync(repoPath, workspaceId);
        SetBusy(false);
    }

    private async Task GuardAsync(Func<Task> action)
    {
        if (busy) return;
        try { await action(); }
        catch (Exception e) when (e is InvalidOperationException or IOException) { SetStatus(e.Message, true); }
    }

    private void SetStatus(string text, bool error)
    {
        status.Text = text;
        status.Foreground = error ? new SolidColorBrush(Color.Parse("#ff8b8b")) : Muted;
    }

    private void SetBusy(bool value)
    {
        busy = value;
        foreach (var button in new[] { openButton, tutorialButton, newToggle, newCreate, newBrowse }) button.IsEnabled = !value;
        recents.IsEnabled = !value;
    }

    private void RenderRecents(IReadOnlyList<RecentRepo> repos)
    {
        recentsPanel.IsVisible = repos.Count > 0;
        recents.Children.Clear();
        foreach (var repo in repos)
        {
            var children = new StackPanel { Background = NestedBg };
            var open = new Button { Classes = { "flat" }, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(14, 11, 40, 11) };
            open.Content = new StackPanel
            {
                Children =
                {
                    NameLabel(repo),
                    new TextBlock { Text = repo.Path, FontSize = 11, Foreground = Muted, TextTrimming = TextTrimming.CharacterEllipsis },
                },
            };
            open.Click += async (_, _) =>
            {
                if (repo.Missing) SetStatus($"Project not found at {repo.Path}. It may have been deleted or moved - remove it from the list with ×.", true);
                else await OpenAsync(repo.Path, null);
            };
            var forget = new Button { Content = "×", Classes = { "tiny" }, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 8, 8, 0), FontSize = 16 };
            ToolTip.SetTip(forget, "Remove from list (the folder is not touched)");
            forget.Click += (_, _) => RenderRecents(RecentRepos.Remove(host.RecentsPath, repo.Path));
            var row = new Grid { Children = { open, forget } };
            recents.Children.Add(new Border { BorderBrush = Line, BorderThickness = new Thickness(0, 0, 0, 1), Child = new StackPanel { Children = { row, children } } });
            _ = LoadWorkspacesAsync(repo, children);
        }
    }

    private static TextBlock NameLabel(RecentRepo repo)
    {
        var label = new TextBlock { Text = repo.Missing ? $"⚠ {repo.Name}" : repo.Name };
        if (repo.Missing) label.Foreground = Muted;
        return label;
    }

    private async Task LoadWorkspacesAsync(RecentRepo repo, StackPanel into)
    {
        var workspaces = await Task.Run(() => WorkspaceSummaries.ForRepo(repo.Path));
        foreach (var workspace in workspaces)
        {
            var button = new Button { Content = workspace.Label, Classes = { "flat" }, FontSize = 12, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left, Padding = new Thickness(28, 9, 14, 9) };
            var id = workspace.Id;
            button.Click += async (_, _) => await OpenAsync(repo.Path, id);
            into.Children.Add(button);
        }
    }
}
