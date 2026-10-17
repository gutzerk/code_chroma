using Avalonia.Controls;
using CodeChroma.Canvas.Diff;
using CodeChroma.Canvas.Hierarchy;
using CodeChroma.Canvas.State;

namespace CodeChroma.Canvas.Avalonia;

/// <summary>The hierarchy canvas with its code popup layered on top; one popup at a time, closing returns focus to the canvas.</summary>
public sealed class HierarchyCanvas : Grid
{
    public HierarchyCanvas(IHierarchySource source, ICodeSource? code = null, IKeyValueStore? storage = null, string workspace = "default")
    {
        Expansion = new ExpansionState(source, storage, () => workspace);
        Layout = new TopLevelLayoutStore(storage, () => workspace);
        View = new HierarchyView(source, Expansion, Layout, code);
        View.CodeRequested += Open;
        Children.Add(View);
    }

    public ExpansionState Expansion { get; }
    public TopLevelLayoutStore Layout { get; }
    public HierarchyView View { get; }
    public CodePopup? Popup { get; private set; }

    /// <summary>The Diff toggle's controller; with it attached the popup shows a node's diff and an Accept button.</summary>
    public DiffController? Diff { get; private set; }

    /// <summary>A read-only workspace (a pull request) still shows diffs but offers no Accept.</summary>
    public bool ReadOnly { get; set; }

    public void AttachDiff(DiffController controller)
    {
        Diff = controller;
        View.Diff = controller.Overlay;
    }

    public void Open(CodeSnippet snippet)
    {
        Close();
        var diff = Diff?.Overlay.DiffOf(snippet.NodeId);
        Popup = new CodePopup(snippet, diff, diff is not null && !ReadOnly && Diff is not null ? () => Diff.AcceptAsync(snippet.NodeId) : null);
        Popup.Closed += Close;
        Children.Add(Popup);
        Popup.Focus();
    }

    public void Close()
    {
        if (Popup is null) return;
        Children.Remove(Popup);
        Popup = null;
        View.Focus();
    }
}
