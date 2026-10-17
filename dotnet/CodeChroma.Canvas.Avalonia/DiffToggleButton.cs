using Avalonia.Automation;
using Avalonia.Controls;
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
        controller.PendingChanged += Sync;
        controller.Overlay.Changed += Sync;
        Sync();
    }

    public string Label => _controller.IsPending ? PendingLabel : _controller.Overlay.IsActive ? OnLabel : OffLabel;

    private void Sync()
    {
        Content = Label;
        AutomationProperties.SetName(this, Label);
    }
}
