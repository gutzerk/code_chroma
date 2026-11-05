using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Controls.Primitives;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Threading;

namespace CodeChroma.Shell.App;

/// <summary>The hover popover over a project tab: its agents, "Allow" for a pending permission, "Open agent", ticking turn timers.</summary>
public sealed class AgentPopover
{
    private static readonly string[] Order = ["blocked", "error", "done", "working", "idle"];
    private readonly Popup popup;
    private readonly ShellController controller;
    private readonly DispatcherTimer openTimer = new() { Interval = TimeSpan.FromMilliseconds(350) };
    private readonly DispatcherTimer closeTimer = new() { Interval = TimeSpan.FromMilliseconds(250) };
    private readonly DispatcherTimer tick = new() { Interval = TimeSpan.FromSeconds(1) };
    private readonly List<(TextBlock Text, DateTimeOffset Start, bool Coarse)> clocks = [];
    private TabChip? pending;
    private TabInfo? shown;

    public AgentPopover(Popup popup, ShellController controller)
    {
        this.popup = popup;
        this.controller = controller;
        openTimer.Tick += (_, _) => { openTimer.Stop(); if (pending is { Info: { } info } chip) Open(chip, info); };
        closeTimer.Tick += (_, _) => Close();
        tick.Tick += (_, _) => Tick();
    }

    public void Enter(TabChip chip)
    {
        closeTimer.Stop();
        if (popup.IsOpen && shown?.Id == chip.Id) return;
        pending = chip;
        openTimer.Stop();
        if (popup.IsOpen && chip.Info is { } info) Open(chip, info);
        else openTimer.Start();
    }

    public void Leave()
    {
        openTimer.Stop();
        pending = null;
        if (popup.IsOpen) closeTimer.Start();
    }

    public void Refresh(IReadOnlyDictionary<string, TabChip> chips)
    {
        if (!popup.IsOpen || shown is null) return;
        if (!chips.TryGetValue(shown.Id, out var chip) || chip.Info is not { } info || !HasAgents(info)) { Close(); return; }
        popup.PlacementTarget = chip;
        if (!Equals(info, shown)) Render(info);
    }

    public void Close()
    {
        closeTimer.Stop();
        tick.Stop();
        popup.IsOpen = false;
        shown = null;
        clocks.Clear();
    }

    private static bool HasAgents(TabInfo info) => info.Agents?.Agents.Any(a => a.Status != "stopped") == true;

    private void Open(TabChip chip, TabInfo info)
    {
        if (!HasAgents(info)) { Close(); return; }
        popup.PlacementTarget = chip;
        Render(info);
        popup.IsOpen = true;
        tick.Start();
    }

    private void Render(TabInfo info)
    {
        shown = info;
        clocks.Clear();
        var summary = info.Agents!;
        var rows = new StackPanel();
        var header = new DockPanel { Margin = new Thickness(14, 12) };
        var counts = Text(AgentRollup.Counts(summary), 12, "PopoverMutedBrush");
        DockPanel.SetDock(counts, Dock.Right);
        header.Children.Add(counts);
        header.Children.Add(new TextBlock { Text = info.Title, FontSize = 13, FontWeight = FontWeight.SemiBold, Foreground = AgentChrome.Brush("PopoverTextBrush"), TextTrimming = TextTrimming.CharacterEllipsis, Margin = new Thickness(0, 0, 12, 0) });
        var agents = summary.Agents.Where(a => Array.IndexOf(Order, a.Status) >= 0).OrderBy(a => Array.IndexOf(Order, a.Status)).ToList();
        foreach (var agent in agents) rows.Children.Add(agent.Status == "blocked" ? Blocked(info.Id, agent) : Row(agent));
        var list = new StackPanel();
        list.Children.Add(Lined(header));
        list.Children.Add(new ScrollViewer { Content = rows, MaxHeight = 420, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        var card = new Border
        {
            Width = 420,
            Background = AgentChrome.Brush("PopoverBrush"),
            BorderBrush = AgentChrome.Brush("PopoverBorderBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(12),
            ClipToBounds = true,
            Child = list,
        };
        card.PointerEntered += (_, _) => closeTimer.Stop();
        card.PointerExited += (_, _) => Leave();
        popup.Child = card;
        Tick();
    }

    private Control Blocked(string tabId, AgentEntry agent)
    {
        var block = new StackPanel { Spacing = 10 };
        var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        head.Children.Add(Glyph("?", "StatusBlockedBrush", "StatusBlockedInkBrush", circle: true));
        head.Children.Add(new TextBlock { Text = agent.Title, FontSize = 13, FontWeight = FontWeight.SemiBold, Foreground = AgentChrome.Brush("PopoverTextBrush"), VerticalAlignment = VerticalAlignment.Center });
        var meta = Text("", 12, "PopoverMutedBrush");
        head.Children.Add(meta);
        if (agent.StatusSince is { } since) clocks.Add((meta, since, true));
        meta.Tag = agent.WorktreeTitle ?? agent.Worktree;
        block.Children.Add(head);

        var permission = agent.PendingPermission;
        var ask = new TextBlock { FontSize = 13, LineHeight = 19, TextWrapping = TextWrapping.Wrap, Foreground = AgentChrome.Brush("PermissionTextBrush") };
        if (permission is not null)
        {
            ask.Inlines!.Add(new Run("Просит разрешение: "));
            ask.Inlines.Add(new Run(permission.Summary ?? permission.Tool ?? "инструмент") { FontFamily = (FontFamily)Application.Current!.FindResource("MonoFont")!, FontSize = 12, Foreground = AgentChrome.Brush("PermissionCodeBrush") });
        }
        else ask.Text = "Ждёт вашего ответа в агенте";
        block.Children.Add(ask);

        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        if (permission is not null)
        {
            var allow = new Button { Content = "Разрешить", Classes = { "chip", "allow" } };
            allow.Click += (_, _) =>
            {
                allow.IsEnabled = false;
                controller.AllowPermission(tabId, agent.Id, permission.RequestId);
            };
            buttons.Children.Add(allow);
        }
        var open = new Button { Content = "Открыть агента", Classes = { "chip", "open" } };
        open.Click += (_, _) =>
        {
            Close();
            controller.OpenAgent(tabId, agent.Id);
        };
        buttons.Children.Add(open);
        block.Children.Add(buttons);
        return Lined(new Border { Background = AgentChrome.Brush("PopoverBlockedBrush"), Padding = new Thickness(14, 12), Child = block });
    }

    private Control Row(AgentEntry agent)
    {
        var row = new DockPanel { Margin = new Thickness(14, 11) };
        var icon = agent.Status switch
        {
            "working" => AgentChrome.Spinner(14),
            "error" => Glyph("!", "StatusErrorBrush", "StatusBlockedInkBrush", circle: false),
            "done" => Glyph("✓", "StatusDoneBrush", "StatusBlockedInkBrush", circle: true),
            _ => AgentChrome.IdleRing(14),
        };
        icon.Margin = new Thickness(0, 0, 10, 0);
        DockPanel.SetDock(icon, Dock.Left);
        row.Children.Add(icon);
        var name = new TextBlock { Text = agent.Title, FontSize = 13, Foreground = AgentChrome.Brush(agent.Status == "idle" ? "PopoverIdleTextBrush" : "PopoverTextBrush"), VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 10, 0) };
        DockPanel.SetDock(name, Dock.Left);
        row.Children.Add(name);
        if (agent.Status == "working" && agent.Activity?.TurnStartedAt is { } started)
        {
            var clock = new TextBlock { FontFamily = (FontFamily)Application.Current!.FindResource("MonoFont")!, FontSize = 11, Foreground = AgentChrome.Brush("PopoverMutedBrush"), VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(10, 0, 0, 0) };
            DockPanel.SetDock(clock, Dock.Right);
            row.Children.Add(clock);
            clocks.Add((clock, started, false));
        }
        var detail = agent.Status switch
        {
            "working" => Activity(agent.Activity),
            "error" => "Ошибка",
            "done" => "Готово",
            _ => "Idle",
        };
        var line = Text(detail, 12, agent.Status == "error" ? "StatusErrorBrush" : "PopoverMutedBrush");
        line.TextTrimming = TextTrimming.CharacterEllipsis;
        row.Children.Add(line);
        return Lined(row);
    }

    private static string Activity(AgentActivity? activity) => activity switch
    {
        { Tool: { } tool, Target: { } target } => $"{tool} · {target}",
        { Tool: { } tool } => tool,
        _ => "Работает",
    };

    private void Tick()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var (text, start, coarse) in clocks)
            text.Text = coarse
                ? string.Join(" · ", new[] { text.Tag as string, AgentRollup.Waiting(now - start) }.Where(s => !string.IsNullOrEmpty(s)))
                : AgentRollup.Clock(now - start);
    }

    private static TextBlock Text(string text, double size, string brush) =>
        new() { Text = text, FontSize = size, Foreground = AgentChrome.Brush(brush), VerticalAlignment = VerticalAlignment.Center };

    private static Control Glyph(string glyph, string background, string foreground, bool circle) =>
        new Border
        {
            Width = 16,
            Height = 16,
            CornerRadius = new CornerRadius(circle ? 8 : 4),
            Background = AgentChrome.Brush(background),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new TextBlock { Text = glyph, FontSize = 11, FontWeight = FontWeight.Bold, Foreground = AgentChrome.Brush(foreground), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center },
        };

    private static Control Lined(Control content) =>
        new Border { BorderBrush = AgentChrome.Brush("PopoverLineBrush"), BorderThickness = new Thickness(0, 0, 0, 1), Child = content };
}
