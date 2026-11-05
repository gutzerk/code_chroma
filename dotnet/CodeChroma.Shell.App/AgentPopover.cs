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
    private readonly Popup popup;
    private readonly ShellController controller;
    private readonly DispatcherTimer openTimer = new() { Interval = TimeSpan.FromMilliseconds(350) };
    private readonly DispatcherTimer closeTimer = new() { Interval = TimeSpan.FromMilliseconds(250) };
    private readonly DispatcherTimer tick = new() { Interval = TimeSpan.FromSeconds(1) };
    private readonly List<RowView> rows = [];
    private TextBlock title = new();
    private TextBlock counts = new();
    private List<(string Id, bool Blocked, AgentPermission? Permission)> layout = [];
    private TabChip? pending;
    private TabInfo? shown;

    /// <summary>A ticking label: an m:ss turn timer, or "worktree · N min" for a blocked agent.</summary>
    private sealed class Clock(TextBlock text, bool coarse)
    {
        public TextBlock Text { get; } = text;
        public bool Coarse { get; } = coarse;
        public DateTimeOffset? Start { get; set; }
        public string? Prefix { get; set; }
    }

    /// <summary>The live parts of one rendered agent row, updated in place on activity-only reports.</summary>
    private sealed class RowView(TextBlock name, Clock clock, Decorator? icon = null, TextBlock? detail = null)
    {
        public TextBlock Name { get; } = name;
        public Clock Clock { get; } = clock;
        public Decorator? Icon { get; } = icon;
        public TextBlock? Detail { get; } = detail;
        public string? Status { get; set; }
    }

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
        rows.Clear();
        layout = [];
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
        var summary = info.Agents!;
        var agents = summary.Agents.Where(a => AgentRollup.Rank(a.Status) >= 0).OrderBy(a => AgentRollup.Rank(a.Status)).ToList();
        var next = agents.Select(a => (a.Id, a.Status == "blocked", a.PendingPermission)).ToList();
        if (shown?.Id != info.Id || !next.SequenceEqual(layout)) Build(info.Id, agents);
        shown = info;
        layout = next;
        title.Text = info.Title;
        counts.Text = AgentRollup.Counts(summary);
        for (var i = 0; i < agents.Count; i++) Update(rows[i], agents[i]);
        Tick();
    }

    private void Build(string tabId, IReadOnlyList<AgentEntry> agents)
    {
        rows.Clear();
        var list = new StackPanel();
        foreach (var agent in agents)
        {
            var (control, view) = agent.Status == "blocked" ? Blocked(tabId, agent) : Row();
            list.Children.Add(control);
            rows.Add(view);
        }
        var header = new DockPanel { Margin = new Thickness(14, 12) };
        counts = Text("", 12, "PopoverMutedBrush");
        DockPanel.SetDock(counts, Dock.Right);
        header.Children.Add(counts);
        title = new TextBlock { FontSize = 13, FontWeight = FontWeight.SemiBold, Foreground = AgentChrome.Brush("PopoverTextBrush"), TextTrimming = TextTrimming.CharacterEllipsis, Margin = new Thickness(0, 0, 12, 0) };
        header.Children.Add(title);
        var body = new StackPanel();
        body.Children.Add(Lined(header));
        body.Children.Add(new ScrollViewer { Content = list, MaxHeight = 420, VerticalScrollBarVisibility = ScrollBarVisibility.Auto });
        var card = new Border
        {
            Width = 420,
            Background = AgentChrome.Brush("PopoverBrush"),
            BorderBrush = AgentChrome.Brush("PopoverBorderBrush"),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(12),
            ClipToBounds = true,
            Child = body,
        };
        card.PointerEntered += (_, _) => closeTimer.Stop();
        card.PointerExited += (_, _) => Leave();
        popup.Child = card;
    }

    private static void Update(RowView view, AgentEntry agent)
    {
        view.Name.Text = agent.Title;
        if (view.Detail is not { } detail || view.Icon is not { } icon)
        {
            view.Clock.Prefix = agent.WorktreeTitle ?? agent.Worktree;
            view.Clock.Start = agent.StatusSince;
            return;
        }
        view.Name.Foreground = AgentChrome.Brush(agent.Status == "idle" ? "PopoverIdleTextBrush" : "PopoverTextBrush");
        if (view.Status != agent.Status)
        {
            icon.Child = Icon(agent.Status);
            view.Status = agent.Status;
        }
        detail.Text = agent.Status switch
        {
            "working" => Activity(agent.Activity),
            "error" => "Failed",
            "done" => "Done",
            _ => "Idle",
        };
        detail.Foreground = AgentChrome.Brush(agent.Status == "error" ? "StatusErrorBrush" : "PopoverMutedBrush");
        view.Clock.Start = agent.Status == "working" ? agent.Activity?.TurnStartedAt : null;
        view.Clock.Text.IsVisible = view.Clock.Start is not null;
    }

    private (Control, RowView) Blocked(string tabId, AgentEntry agent)
    {
        var block = new StackPanel { Spacing = 10 };
        var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        head.Children.Add(Glyph("?", "StatusBlockedBrush", "StatusBlockedInkBrush", circle: true));
        var name = new TextBlock { FontSize = 13, FontWeight = FontWeight.SemiBold, Foreground = AgentChrome.Brush("PopoverTextBrush"), VerticalAlignment = VerticalAlignment.Center };
        head.Children.Add(name);
        var meta = Text("", 12, "PopoverMutedBrush");
        head.Children.Add(meta);
        block.Children.Add(head);

        var permission = agent.PendingPermission;
        var ask = new TextBlock { FontSize = 13, LineHeight = 19, TextWrapping = TextWrapping.Wrap, Foreground = AgentChrome.Brush("PermissionTextBrush") };
        if (permission is not null)
        {
            ask.Inlines!.Add(new Run("Asking permission: "));
            ask.Inlines.Add(new Run(permission.Summary ?? permission.Tool ?? "a tool") { FontFamily = AgentChrome.Font("MonoFont"), FontSize = 12, Foreground = AgentChrome.Brush("PermissionCodeBrush") });
        }
        else ask.Text = "Waiting for your answer";
        block.Children.Add(ask);

        var buttons = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        if (permission is not null)
        {
            var allow = new Button { Content = "Allow", Classes = { "chip", "allow" } };
            allow.Click += (_, _) =>
            {
                allow.IsEnabled = false;
                controller.AllowPermission(tabId, agent.Id, permission.RequestId);
            };
            buttons.Children.Add(allow);
        }
        var open = new Button { Content = "Open agent", Classes = { "chip", "open" } };
        open.Click += (_, _) =>
        {
            Close();
            controller.OpenAgent(tabId, agent.Id);
        };
        buttons.Children.Add(open);
        block.Children.Add(buttons);
        return (Lined(new Border { Background = AgentChrome.Brush("PopoverBlockedBrush"), Padding = new Thickness(14, 12), Child = block }), new RowView(name, new Clock(meta, coarse: true)));
    }

    private static (Control, RowView) Row()
    {
        var row = new DockPanel { Margin = new Thickness(14, 11) };
        var icon = new Decorator { Margin = new Thickness(0, 0, 10, 0), VerticalAlignment = VerticalAlignment.Center };
        DockPanel.SetDock(icon, Dock.Left);
        row.Children.Add(icon);
        var name = new TextBlock { FontSize = 13, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 0, 10, 0) };
        DockPanel.SetDock(name, Dock.Left);
        row.Children.Add(name);
        var clock = new TextBlock { FontFamily = AgentChrome.Font("MonoFont"), FontSize = 11, Foreground = AgentChrome.Brush("PopoverMutedBrush"), VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(10, 0, 0, 0) };
        DockPanel.SetDock(clock, Dock.Right);
        row.Children.Add(clock);
        var detail = Text("", 12, "PopoverMutedBrush");
        detail.TextTrimming = TextTrimming.CharacterEllipsis;
        row.Children.Add(detail);
        return (Lined(row), new RowView(name, new Clock(clock, coarse: false), icon, detail));
    }

    private static Control Icon(string status) => status switch
    {
        "working" => AgentChrome.Spinner(14),
        "error" => Glyph("!", "StatusErrorBrush", "StatusBlockedInkBrush", circle: false),
        "done" => Glyph("✓", "StatusDoneBrush", "StatusBlockedInkBrush", circle: true),
        _ => AgentChrome.IdleRing(14),
    };

    private static string Activity(AgentActivity? activity) => activity switch
    {
        { Tool: { } tool, Target: { } target } => $"{tool} · {target}",
        { Tool: { } tool } => tool,
        _ => "Working",
    };

    private void Tick()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var clock in rows.Select(r => r.Clock))
            clock.Text.Text = clock.Start is not { } start ? ""
                : clock.Coarse ? string.Join(" · ", new[] { clock.Prefix, AgentRollup.Waiting(now - start) }.Where(s => !string.IsNullOrEmpty(s)))
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
