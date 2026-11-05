using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;

namespace CodeChroma.Shell.App;

/// <summary>One project tab of the strip: status dot, title, badge, close; kept across redraws so the spinner keeps turning.</summary>
public sealed class TabChip : Border
{
    private readonly Panel dotSlot = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly Panel badgeSlot = new() { VerticalAlignment = VerticalAlignment.Center };
    private readonly TextBlock title = new() { FontSize = 13, TextTrimming = TextTrimming.CharacterEllipsis, VerticalAlignment = VerticalAlignment.Center, MaxWidth = 220 };
    private readonly Button close = new() { Content = "×", Classes = { "tiny" }, Padding = new Thickness(2, 0), FontSize = 13, VerticalAlignment = VerticalAlignment.Center };
    private TabBadge shown = TabBadge.None;

    public TabChip(string id, Action<string> select, Func<string, Task> closeTab)
    {
        Id = id;
        var body = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        body.Children.Add(dotSlot);
        body.Children.Add(title);
        body.Children.Add(badgeSlot);
        body.Children.Add(close);
        Child = body;
        CornerRadius = new CornerRadius(8, 8, 0, 0);
        VerticalAlignment = VerticalAlignment.Bottom;
        Cursor = new Cursor(StandardCursorType.Hand);
        close.Click += async (_, e) => { e.Handled = true; await closeTab(Id); };
        PointerPressed += (_, _) => select(Id);
    }

    public string Id { get; }

    public TabInfo? Info { get; private set; }

    public void Update(TabInfo info, bool active)
    {
        Info = info;
        title.Text = info.Title;
        title.Foreground = AgentChrome.Brush(active ? "TabActiveTextBrush" : "TabTextBrush");
        title.FontWeight = active ? FontWeight.Medium : FontWeight.Normal;
        close.Foreground = AgentChrome.Brush(active ? "TabActiveCloseBrush" : "TabCloseBrush");
        Height = active ? 34 : 32;
        Padding = new Thickness(active ? 14 : 12, 0);
        Background = active ? AgentChrome.Brush("TabActiveBrush") : Brushes.Transparent;
        BorderBrush = AgentChrome.Brush("TabActiveBorderBrush");
        BorderThickness = active ? new Thickness(1, 1, 1, 0) : new Thickness(0);
        Show(AgentRollup.Badge(info.Agents, active));
    }

    private void Show(TabBadge badge)
    {
        if (badge.Dot != shown.Dot)
        {
            dotSlot.Children.Clear();
            if (AgentChrome.Dot(badge.Dot) is { } dot) dotSlot.Children.Add(dot);
        }
        if (badge != shown)
        {
            badgeSlot.Children.Clear();
            if (AgentChrome.Badge(badge.Dot, badge.Count) is { } count) badgeSlot.Children.Add(count);
        }
        dotSlot.IsVisible = badge.Dot is not null;
        badgeSlot.IsVisible = badge.Count > 0;
        shown = badge;
    }
}
