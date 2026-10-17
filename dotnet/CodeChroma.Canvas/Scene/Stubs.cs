using System.Numerics;

namespace CodeChroma.Canvas.Scene;

public readonly record struct ViewState(double X, double Y, double Scale);

public readonly record struct TextSize(double Width, double Height);

public interface ITextMeasurer
{
    double LineHeight { get; }
    TextSize Measure(string text, double maxWidth, double fontSize);
}

public sealed class Viewport
{
    public Viewport(ViewState state, double width, double height) => throw new NotImplementedException();
    public ViewState State => throw new NotImplementedException();
    public Matrix3x2 Matrix => throw new NotImplementedException();
    public void ZoomAround(Point cursor, double factor) => throw new NotImplementedException();
    public void Pan(double dx, double dy) => throw new NotImplementedException();
    public Point CanvasToScreen(Point p) => throw new NotImplementedException();
    public Point ScreenToCanvas(Point p) => throw new NotImplementedException();
    public Rect VisibleCanvasRect(double marginPx = 0) => throw new NotImplementedException();
    public ViewState ComputeFit(Rect canvasRect) => throw new NotImplementedException();
}

public sealed record SceneNode(CanvasElement Element, Rect Rect)
{
    public string Id => Element.Id;
}

public sealed class SceneGraph
{
    public const int DescriptionLineClamp = 3;
    public SceneGraph(CanvasDoc doc, ITextMeasurer? measurer = null) => throw new NotImplementedException();
    public Rect Bounds => throw new NotImplementedException();
    public Rect RectOf(string id) => throw new NotImplementedException();
    public void Move(string id, Position position) => throw new NotImplementedException();
    public IReadOnlyList<SceneNode> Query(Rect canvasRect) => throw new NotImplementedException();
    public IReadOnlyList<SceneNode> Cull(Viewport viewport, double margin = 200) => throw new NotImplementedException();
}
