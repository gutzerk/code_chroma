using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.VisualTree;
using CodeChroma.Canvas.Agents;
using AvCanvas = Avalonia.Controls.Canvas;

namespace CodeChroma.Canvas.Avalonia;

/// <summary>
/// The agent windows and their rail (AgentWindowLayer.tsx + AgentRail.tsx): floating windows in screen coordinates above the
/// canvas, a rail entry per agent for its whole lifetime, and a Run agent button that disables at the limit. A window's content
/// (the terminal host, supplied by the shell) is created once and stays mounted while the window is minimized, so restoring is
/// not a reattach.
/// </summary>
public sealed class AgentWorkspaceView : Grid
{
    private readonly AgentWindowStore _store;
    private readonly Func<AgentRecord, Control> _contentFactory;
    private readonly Dictionary<string, AgentWindow> _windows = new();
    private readonly Dictionary<string, Button> _railItems = new();

    public AgentWorkspaceView(AgentWindowStore store, Func<AgentRecord, Control> contentFactory)
    {
        _store = store;
        _contentFactory = contentFactory;
        WindowLayer = new AvCanvas();
        RunButton = new Button { Content = "Run agent", HorizontalAlignment = HorizontalAlignment.Stretch };
        RunButton.Click += async (_, _) => await _store.LaunchAsync();
        AutomationProperties.SetName(RunButton, "Run agent");
        RailPanel = new StackPanel { Spacing = 4, Width = 200, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Top };
        RailPanel.Children.Add(RunButton);
        Children.Add(WindowLayer);
        Children.Add(RailPanel);
        store.Changed += Sync;
        Sync();
    }

    public AvCanvas WindowLayer { get; }
    public StackPanel RailPanel { get; }
    public Button RunButton { get; }

    /// <summary>The workspace the canvas is drawing; launching an agent leaves it alone.</summary>
    public string ActiveWorkspace => _store.ActiveWorkspace;

    public AgentWindow? WindowOf(string id) => _windows.GetValueOrDefault(id);
    public Button? RailItem(string id) => _railItems.GetValueOrDefault(id);

    protected override void OnSizeChanged(SizeChangedEventArgs e)
    {
        base.OnSizeChanged(e);
        _store.SetViewport(e.NewSize.Width, e.NewSize.Height);
    }

    private void Sync()
    {
        foreach (var gone in _windows.Keys.Where(id => _store.Get(id) is null).ToList())
        {
            WindowLayer.Children.Remove(_windows[gone]);
            _windows.Remove(gone);
        }
        foreach (var gone in _railItems.Keys.Where(id => _store.Get(id) is null).ToList())
        {
            RailPanel.Children.Remove(_railItems[gone]);
            _railItems.Remove(gone);
        }
        foreach (var agent in _store.Agents)
        {
            if (!_windows.TryGetValue(agent.Id, out var window))
            {
                _windows[agent.Id] = window = new AgentWindow(_store, agent.Id, _contentFactory(agent));
                WindowLayer.Children.Add(window);
            }
            window.Apply(agent);
            if (!_railItems.ContainsKey(agent.Id))
            {
                var item = new Button { HorizontalAlignment = HorizontalAlignment.Stretch, HorizontalContentAlignment = HorizontalAlignment.Left };
                var id = agent.Id;
                item.Click += async (_, _) => await _store.ToggleFromRailAsync(id);
                _railItems[agent.Id] = item;
                RailPanel.Children.Add(item);
            }
        }
        foreach (var entry in _store.Rail)
        {
            var item = _railItems[entry.Id];
            item.Content = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 6,
                Children =
                {
                    AgentWindow.Led(entry.Status),
                    new StackPanel { Children = { new TextBlock { Text = entry.Title, FontWeight = FontWeight.SemiBold }, new TextBlock { Text = entry.StatusText, FontSize = 11 } } },
                },
            };
            item.Opacity = entry.OffBranch ? 0.55 : 1;
            item.Classes.Set("pressed", entry.Pressed);
            AutomationProperties.SetName(item, $"{entry.Title} — {entry.StatusText}");
        }
        RunButton.IsEnabled = _store.CanRun;
        ToolTip.SetTip(RunButton, _store.RunDisabledReason);
    }
}

/// <summary>One floating agent window: LED, draggable title bar, minimize and close, and the terminal host below.</summary>
public sealed class AgentWindow : Border
{
    private readonly AgentWindowStore _store;
    private readonly string _id;
    private readonly Border _led;
    private Point _last;
    private bool _dragging;

    public AgentWindow(AgentWindowStore store, string id, Control content)
    {
        _store = store;
        _id = id;
        Content = content;
        _led = Led("idle");
        TitleText = new TextBlock { VerticalAlignment = VerticalAlignment.Center, FontWeight = FontWeight.SemiBold };
        MinimizeButton = new Button { Content = "_", Width = 28 };
        MinimizeButton.Click += async (_, _) => await _store.MinimizeAsync(_id);
        AutomationProperties.SetName(MinimizeButton, $"Minimize {id}");
        CloseButton = new Button { Content = "x", Width = 28 };
        CloseButton.Click += async (_, _) => await _store.CloseAsync(_id);
        AutomationProperties.SetName(CloseButton, $"Close {id}");
        var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Children = { MinimizeButton, CloseButton } };
        TitleBar = new Border { Background = Brushes.WhiteSmoke, Height = 32, Child = new Grid { Children = { new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, Margin = new Thickness(8, 0), Children = { _led, TitleText } }, buttons } } };
        TitleBar.PointerPressed += OnTitlePressed;
        TitleBar.PointerMoved += OnTitleMoved;
        TitleBar.PointerReleased += async (_, e) =>
        {
            if (!_dragging) return;
            _dragging = false;
            e.Pointer.Capture(null);
            await _store.CommitWindowAsync(_id);
        };
        var body = new Grid { RowDefinitions = new RowDefinitions("Auto,*") };
        body.Children.Add(TitleBar);
        Grid.SetRow(content, 1);
        body.Children.Add(content);
        Child = body;
        Background = Brushes.White;
        BorderBrush = Brushes.DimGray;
        BorderThickness = new Thickness(1);
        CornerRadius = new CornerRadius(8);
        ClipToBounds = true;
        PointerPressed += (_, _) => _store.BringToFront(_id);
    }

    public Control Content { get; }
    public Border TitleBar { get; }
    public TextBlock TitleText { get; }
    public Button MinimizeButton { get; }
    public Button CloseButton { get; }

    public static Border Led(string status) => new()
    {
        Width = 10, Height = 10, CornerRadius = new CornerRadius(5), VerticalAlignment = VerticalAlignment.Center,
        Background = status switch { "idle" => Brushes.SeaGreen, "working" => Brushes.DodgerBlue, "blocked" => Brushes.Orange, "exited" => Brushes.Firebrick, _ => Brushes.Gray },
    };

    public void Apply(AgentRecord agent)
    {
        TitleText.Text = agent.Title;
        AvCanvas.SetLeft(this, agent.Window.X);
        AvCanvas.SetTop(this, agent.Window.Y);
        Width = agent.Window.Width;
        Height = agent.Window.Height;
        ZIndex = agent.Window.Z;
        IsVisible = !agent.Window.Minimized;
        _led.Background = Led(agent.Status).Background;
    }

    private void OnTitlePressed(object? sender, PointerPressedEventArgs e)
    {
        if (e.Source is Visual v && (v is Button || v.GetVisualParent() is Button)) return;
        _dragging = true;
        _last = e.GetPosition((Visual?)Parent);
        e.Pointer.Capture(TitleBar);
    }

    private void OnTitleMoved(object? sender, PointerEventArgs e)
    {
        if (!_dragging) return;
        var now = e.GetPosition((Visual?)Parent);
        _store.Move(_id, now.X - _last.X, now.Y - _last.Y);
        _last = now;
    }
}
