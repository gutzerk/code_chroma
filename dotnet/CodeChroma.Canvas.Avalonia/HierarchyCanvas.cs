using Avalonia.Controls;
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

    public void Open(CodeSnippet snippet)
    {
        Close();
        Popup = new CodePopup(snippet);
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
