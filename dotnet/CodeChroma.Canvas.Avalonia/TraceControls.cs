using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.VisualTree;
using CodeChroma.Canvas.Tracing;

namespace CodeChroma.Canvas.Avalonia;

/// <summary>
/// The trace playback bar (port of TraceControls.tsx): pick a recorded run, step / play / scrub through it, set a breakpoint on
/// the current node, follow the camera, read the error plaque and the reconstructed call stack. It only reads and writes the
/// <see cref="TracePlayer"/>; the picker's runs and the loader come from the bridge client.
/// </summary>
public sealed class TraceControls : StackPanel
{
    private static readonly double[] Speeds = [0.5, 1, 2, 4];

    private readonly TracePlayer _player;
    private readonly Func<string, Trace?> _load;
    private readonly Func<string, string> _nameOf;
    private bool _syncing;

    public TraceControls(TracePlayer player, IReadOnlyList<TraceSummary> traces, Func<string, Trace?> load, Func<string, string> nameOf)
    {
        _player = player;
        _load = load;
        _nameOf = nameOf;
        Spacing = 4;

        Picker = new ComboBox { MinWidth = 220 };
        Picker.Items.Add("Select a trace...");
        foreach (var t in traces) Picker.Items.Add($"{(t.Status == "failed" ? "! " : "")}{(t.Entry.Length > 0 ? t.Entry : t.Id)} ({t.StepCount})");
        Picker.SelectedIndex = 0;
        Picker.SelectionChanged += (_, _) =>
        {
            if (_syncing || Picker.SelectedIndex <= 0) return;
            if (_load(traces[Picker.SelectedIndex - 1].Id) is { } trace) _player.LoadTrace(trace);
        };
        StepBackButton = new Button { Content = "<", Width = 32 };
        StepBackButton.Click += (_, _) => _player.StepBack();
        PlayButton = new Button { Content = ">", Width = 32 };
        PlayButton.Click += (_, _) => _player.TogglePlay();
        StepForwardButton = new Button { Content = ">|", Width = 32 };
        StepForwardButton.Click += (_, _) => _player.StepForward();
        SpeedPicker = new ComboBox { Width = 70 };
        foreach (var s in Speeds) SpeedPicker.Items.Add($"{s}x");
        SpeedPicker.SelectedIndex = 1;
        SpeedPicker.SelectionChanged += (_, _) => { if (!_syncing && SpeedPicker.SelectedIndex >= 0) _player.SetSpeed(Speeds[SpeedPicker.SelectedIndex]); };
        StepCounter = new TextBlock { VerticalAlignment = VerticalAlignment.Center, Text = "0/0" };

        Scrub = new Slider { Minimum = 0, Maximum = 0, MinWidth = 220 };
        Scrub.ValueChanged += (_, e) => { if (!_syncing) _player.ScrubTo((int)Math.Round(e.NewValue)); };

        CurrentNode = new TextBlock { Text = "-" };
        FollowToggle = new CheckBox { Content = "Follow", IsChecked = true };
        FollowToggle.IsCheckedChanged += (_, _) => { if (!_syncing) _player.SetFollowCamera(FollowToggle.IsChecked == true); };
        BreakpointButton = new Button { Content = "Breakpoint" };
        BreakpointButton.Click += (_, _) => { if (_player.CurrentFrame?.NodeId is { } id) _player.ToggleBreakpoint(id); };
        CloseButton = new Button { Content = "Close" };
        CloseButton.Click += (_, _) => _player.Clear();
        ErrorPlaque = new TextBlock { Foreground = Brushes.Firebrick, IsVisible = false };
        CallStack = new StackPanel();

        Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, Children = { Picker, StepBackButton, PlayButton, StepForwardButton, SpeedPicker, StepCounter } });
        Children.Add(Scrub);
        Children.Add(new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8, Children = { CurrentNode, FollowToggle, BreakpointButton, CloseButton } });
        Children.Add(ErrorPlaque);
        Children.Add(CallStack);
        Sync();
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        _player.Changed += OnPlayerChanged;
        Sync();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnDetachedFromVisualTree(e);
        _player.Changed -= OnPlayerChanged;
    }

    private void OnPlayerChanged() => UiThread.Run(Sync);

    public ComboBox Picker { get; }
    public Button StepBackButton { get; }
    public Button PlayButton { get; }
    public Button StepForwardButton { get; }
    public ComboBox SpeedPicker { get; }
    public TextBlock StepCounter { get; }
    public Slider Scrub { get; }
    public TextBlock CurrentNode { get; }
    public CheckBox FollowToggle { get; }
    public Button BreakpointButton { get; }
    public Button CloseButton { get; }
    public TextBlock ErrorPlaque { get; }
    public StackPanel CallStack { get; }

    private void Sync()
    {
        _syncing = true;
        var total = _player.Steps.Count;
        var current = _player.CurrentFrame;
        var enabled = total > 0 && !_player.IsLive;
        StepBackButton.IsEnabled = StepForwardButton.IsEnabled = PlayButton.IsEnabled = Scrub.IsEnabled = enabled;
        PlayButton.Content = _player.IsPlaying ? "||" : ">";
        StepCounter.Text = $"{(total > 0 ? _player.StepIndex + 1 : 0)}/{total}";
        Scrub.Maximum = Math.Max(total - 1, 0);
        Scrub.Value = _player.StepIndex;
        SpeedPicker.SelectedIndex = Array.IndexOf(Speeds, _player.Speed);
        FollowToggle.IsChecked = _player.FollowCamera;
        BreakpointButton.IsEnabled = current?.NodeId is not null;
        CurrentNode.Text = (current?.NodeId is { } id ? _nameOf(id) : "-") + (current is null ? "" : $" . {current.Event}");
        CurrentNode.Foreground = current is { IsErrorFrame: true } && current.Event is "raise" or "unwind" ? Brushes.Firebrick : Brushes.Black;
        ErrorPlaque.IsVisible = current?.Error is not null;
        ErrorPlaque.Text = current?.Error is { } e ? $"{e.Type}: {e.Message}{(e.Handled ? " (handled)" : "")}" : "";
        if (_player.Trace is null) Picker.SelectedIndex = 0;
        CallStack.Children.Clear();
        foreach (var (nodeId, depth) in TracePlayer.CallStackAt(_player.Steps, _player.StepIndex))
            CallStack.Children.Add(new TextBlock { Text = _nameOf(nodeId), Margin = new Thickness(depth * 12, 0, 0, 0) });
        _syncing = false;
    }
}
