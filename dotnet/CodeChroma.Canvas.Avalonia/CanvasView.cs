using Avalonia.Controls;
using CodeChroma.Canvas.Connectors;
using CodeChroma.Canvas.Model;
using CodeChroma.Canvas.Scene;
using CodeChroma.Canvas.State;

namespace CodeChroma.Canvas.Avalonia;

public sealed class AvaloniaTextMeasurer : ITextMeasurer
{
    public double LineHeight => throw new NotImplementedException();
    public TextSize Measure(string text, double maxWidth, double fontSize) => throw new NotImplementedException();
}

public sealed class CanvasView : Control
{
    public CanvasView(CanvasDocStore store, ICanvasBridge bridge) => throw new NotImplementedException();
    public Viewport Viewport => throw new NotImplementedException();
    public SceneGraph Scene => throw new NotImplementedException();
    public IReadOnlyCollection<string> Selection => throw new NotImplementedException();
    public IReadOnlyList<string> RealisedIds => throw new NotImplementedException();
    public DragOffsetStore DragOffsets => throw new NotImplementedException();
    public IReadOnlyList<RoutedEdge<CanvasEdge>> RoutedEdges => throw new NotImplementedException();
}
