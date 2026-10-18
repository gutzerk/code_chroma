using Avalonia;
using Avalonia.Automation;
using Avalonia.Controls;
using Avalonia.VisualTree;
using CodeChroma.Canvas.Diff;

namespace CodeChroma.Canvas.Avalonia;

/// <summary>
/// The rail's Diff button (RootCanvas.tsx's diff-toggle-button): off, loading (a click cancels, so it is never disabled) and on,
/// each with the label the web exposed as its aria-label.
/// </summary>
public sealed class DiffToggleButton : Button
{
    public const string OffLabel = "Show diff vs last commit", OnLabel = "Hide diff, keep code open", PendingLabel = "Loading diff… click to cancel";

    private readonly DiffController _controller;

    protected override Type StyleKeyOverride => typeof(Button);

    public DiffToggleButton(DiffController controller)
    {
        _controller = controller;
        Click += async (_, _) => await _controller.ToggleAsync();
        Sync();
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        _controller.PendingChanged += OnChanged;
        _controller.Overlay.Changed += OnChanged;
        Sync();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnDetachedFromVisualTree(e);
        _controller.PendingChanged -= OnChanged;
        _controller.Overlay.Changed -= OnChanged;
    }

    private void OnChanged() => UiThread.Run(Sync);

    public string Label => _controller.IsPending ? PendingLabel : _controller.Overlay.IsActive ? OnLabel : OffLabel;

    private void Sync()
    {
        Content = Label;
        AutomationProperties.SetName(this, Label);
    }
}
