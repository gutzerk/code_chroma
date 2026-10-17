using Avalonia;
using Avalonia.Controls;
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

/// <summary>The open-project screen of an empty tab: open a folder, recent projects with their workspaces, new project, tutorial.</summary>
public sealed class LauncherPanel : UserControl
{
    private readonly ILauncherHost host;
    private readonly TextBlock status = new() { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 8) };
    private readonly StackPanel recents = new() { Spacing = 4 };
    private readonly StackPanel recentsSection = new() { Spacing = 6 };
    private readonly Button openButton = new() { Content = "Open repository…" };
    private readonly Button tutorialButton = new() { Content = "Open the tutorial project" };
    private readonly Button newToggle = new() { Content = "New project…" };
    private readonly StackPanel newForm = new() { Spacing = 6, IsVisible = false };
    private readonly TextBox newName = new() { Watermark = "Project name" };
    private readonly TextBlock newLocation = new() { Text = "No location chosen", Opacity = 0.7 };
    private readonly Button newBrowse = new() { Content = "Choose location…" };
    private readonly Button newCreate = new() { Content = "Create and open" };
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
        recentsSection.Children.Add(new TextBlock { Text = "Recent projects", FontWeight = FontWeight.SemiBold });
        recentsSection.Children.Add(recents);

        Content = new ScrollViewer
        {
            HorizontalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Disabled,
            Content = new StackPanel
            {
                Width = 560,
                Spacing = 8,
                Margin = new Thickness(0, 48),
                HorizontalAlignment = HorizontalAlignment.Center,
                Children =
                {
                    new TextBlock { Text = "CodeChroma", FontSize = 28, FontWeight = FontWeight.Bold },
                    new TextBlock { Text = "Open a repository to see its architecture as a map.", Opacity = 0.7 },
                    new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { openButton, tutorialButton, newToggle } },
                    newForm,
                    status,
                    recentsSection,
                },
            },
        };
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
        status.Foreground = error ? Brushes.IndianRed : null;
    }

    private void SetBusy(bool value)
    {
        busy = value;
        foreach (var button in new[] { openButton, tutorialButton, newToggle, newCreate, newBrowse }) button.IsEnabled = !value;
        recents.IsEnabled = !value;
    }

    private void RenderRecents(IReadOnlyList<RecentRepo> repos)
    {
        recentsSection.IsVisible = repos.Count > 0;
        recents.Children.Clear();
        foreach (var repo in repos)
        {
            var children = new StackPanel { Margin = new Thickness(24, 0, 0, 0), Spacing = 2 };
            var open = new Button { HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left };
            open.Content = new StackPanel
            {
                Children =
                {
                    new TextBlock { Text = repo.Missing ? $"⚠ {repo.Name}" : repo.Name },
                    new TextBlock { Text = repo.Path, FontSize = 11, Opacity = 0.6 },
                },
            };
            open.Click += async (_, _) =>
            {
                if (repo.Missing) SetStatus($"Project not found at {repo.Path}. It may have been deleted or moved - remove it from the list with ×.", true);
                else await OpenAsync(repo.Path, null);
            };
            var forget = new Button { Content = "×" };
            ToolTip.SetTip(forget, "Remove from list (the folder is not touched)");
            forget.Click += (_, _) => RenderRecents(RecentRepos.Remove(host.RecentsPath, repo.Path));
            var row = new DockPanel();
            DockPanel.SetDock(forget, Dock.Right);
            row.Children.Add(forget);
            row.Children.Add(open);
            recents.Children.Add(row);
            recents.Children.Add(children);
            _ = LoadWorkspacesAsync(repo, children);
        }
    }

    private async Task LoadWorkspacesAsync(RecentRepo repo, StackPanel into)
    {
        var workspaces = await Task.Run(() => WorkspaceSummaries.ForRepo(repo.Path));
        foreach (var workspace in workspaces)
        {
            var button = new Button { Content = workspace.Label, HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left };
            var id = workspace.Id;
            button.Click += async (_, _) => await OpenAsync(repo.Path, id);
            into.Children.Add(button);
        }
    }
}
