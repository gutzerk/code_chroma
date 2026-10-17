namespace CodeChroma.Canvas.Layout;

public sealed record LayoutBoxSpec(string Id, double Width, double Height, string? Order = null, string? Lane = null);

public sealed record LayoutEdge(string From, string To, string? Kind = null);

public sealed record PositionedBox(string Id, double X, double Y, double Width, double Height);

public sealed record LayoutResult(IReadOnlyList<PositionedBox> Boxes, double Width, double Height);

public static class LayeredLayout
{
    public static LayoutResult Compute(IReadOnlyList<LayoutBoxSpec> nodes, IReadOnlyList<LayoutEdge> edges, Action<string>? warn = null) => throw new NotImplementedException();
}

public sealed record AutoLayoutResult(IReadOnlyDictionary<string, Position> Positions, IReadOnlyDictionary<string, Size>? Sizes);

public static class AutoLayout
{
    public static AutoLayoutResult LayoutNewElements(CanvasDoc doc, IReadOnlyList<string> newIds, IReadOnlyDictionary<string, Position>? fixedPositions = null) => throw new NotImplementedException();
}

public sealed record EpicsLayoutResult(IReadOnlyDictionary<string, Position> Positions, IReadOnlyDictionary<string, Size> Sizes, Size Size);

public static class EpicsLayout
{
    public static bool IsEpicsLayerName(string layer) => throw new NotImplementedException();
    public static bool IsEpicsLayer(CanvasDoc doc, IReadOnlyList<string> ids) => throw new NotImplementedException();
    public static double FitContentWidth(CanvasElement element) => throw new NotImplementedException();
    public static double FitContentHeight(CanvasElement element, double width) => throw new NotImplementedException();
    public static int StoryGroupCount(string text) => throw new NotImplementedException();
    public static EpicsLayoutResult Layout(CanvasDoc doc, IReadOnlyList<string> epicIds, IReadOnlyDictionary<string, double>? measuredHeights = null) => throw new NotImplementedException();
}

public sealed record SpecStory(string? Intro, string? Title, string? Priority, string? Why, IReadOnlyList<string> Criteria);

public static class SpecStories
{
    public static IReadOnlyList<SpecStory> Parse(string description) => throw new NotImplementedException();
}

public static class PileLayout
{
    public static IReadOnlyDictionary<string, IReadOnlyList<string>> FindUnplaced(CanvasDoc doc, ISet<string> skipLayers, ISet<string> done) => throw new NotImplementedException();
    public static IReadOnlyList<CanvasOp> LayoutOps(IReadOnlyDictionary<string, Position> positions, IReadOnlyDictionary<string, Size>? sizes = null) => throw new NotImplementedException();
}
