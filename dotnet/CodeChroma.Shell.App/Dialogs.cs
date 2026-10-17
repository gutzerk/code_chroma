using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;

namespace CodeChroma.Shell.App;

public static class Dialogs
{
    public static Task ShowMessageAsync(Window owner, string title, string message, string? detail = null)
    {
        var ok = new Button { Content = "OK", HorizontalAlignment = HorizontalAlignment.Right, IsDefault = true };
        var panel = new StackPanel { Margin = new Thickness(20), Spacing = 10, MinWidth = 320 };
        panel.Children.Add(new TextBlock { Text = message, FontWeight = FontWeight.SemiBold, FontSize = 16, TextWrapping = TextWrapping.Wrap });
        if (detail is not null) panel.Children.Add(new TextBlock { Text = detail, TextWrapping = TextWrapping.Wrap, MaxWidth = 480 });
        panel.Children.Add(ok);
        var window = new Window { Title = title, Content = panel, SizeToContent = SizeToContent.WidthAndHeight, CanResize = false, WindowStartupLocation = WindowStartupLocation.CenterOwner };
        ok.Click += (_, _) => window.Close();
        return window.ShowDialog(owner);
    }

    public static Task ShowAboutAsync(Window owner, string version)
    {
        var about = AppInfo.About(version);
        return ShowMessageAsync(owner, about.Title, about.Message, about.Detail);
    }

    public static async Task<BranchPick> PickBranchAsync(Window owner, string project, BranchChoices choices)
    {
        var list = new ListBox { MaxHeight = 220, MinWidth = 360 };
        foreach (var branch in choices.Branches) list.Items.Add(new ListBoxItem { Content = branch.Open ? $"{branch.Name} (open)" : branch.Name, Tag = branch.Name });
        var newName = new TextBox { Watermark = "or a new branch name" };
        var from = new TextBox { Text = choices.Current ?? "", Watermark = "start point" };
        var open = new Button { Content = "Open", IsDefault = true };
        var cancel = new Button { Content = "Cancel", IsCancel = true };
        BranchPick result = new BranchPick.Cancel();
        var window = new Window
        {
            Title = $"Open {project} on a branch",
            SizeToContent = SizeToContent.WidthAndHeight,
            CanResize = false,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
        };
        open.Click += (_, _) =>
        {
            if (!string.IsNullOrWhiteSpace(newName.Text)) result = new BranchPick.New(newName.Text.Trim(), string.IsNullOrWhiteSpace(from.Text) ? null : from.Text.Trim());
            else if (list.SelectedItem is ListBoxItem { Tag: string name }) result = new BranchPick.Existing(name);
            else return;
            window.Close();
        };
        cancel.Click += (_, _) => window.Close();
        window.Content = new StackPanel
        {
            Margin = new Thickness(20),
            Spacing = 8,
            Children =
            {
                new TextBlock { Text = $"{project} is already open. Which branch should the new tab show?", TextWrapping = TextWrapping.Wrap, MaxWidth = 420 },
                list,
                newName,
                from,
                new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, HorizontalAlignment = HorizontalAlignment.Right, Children = { cancel, open } },
            },
        };
        await window.ShowDialog(owner);
        return result;
    }
}
