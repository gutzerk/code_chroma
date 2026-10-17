namespace CodeChroma.Canvas.Scene;

public readonly record struct TextSize(double Width, double Height);

/// <summary>Text layout measurement; the Avalonia view supplies one backed by its text layout engine.</summary>
public interface ITextMeasurer
{
    double LineHeight { get; }
    TextSize Measure(string text, double maxWidth, double fontSize);
}

public sealed record SceneNode(CanvasElement Element, Rect Rect)
{
    public string Id => Element.Id;
}

/// <summary>
/// The model-owned scene: every element's rectangle is computed from the document (position, size, text measured by the
/// layout engine), never read back from rendered output. A uniform-grid spatial index answers viewport queries so only
/// the boxes on screen need a visual.
/// </summary>
public sealed class SceneGraph
{
    public const int DescriptionLineClamp = 3;
    public const double DefaultWidth = 300, DefaultHeight = 72;
    private const double Chrome = 44, TextPadding = 32, FontSize = 13, CellSize = 512;

    private readonly ITextMeasurer? _measurer;
    private readonly Dictionary<string, SceneNode> _nodes = new();
    private readonly Dictionary<(int, int), List<string>> _cells = new();
    private readonly List<string> _order = new();

    public SceneGraph(CanvasDoc doc, ITextMeasurer? measurer = null)
    {
        _measurer = measurer;
        foreach (var element in doc.Elements.Values) Insert(element);
    }

    public IEnumerable<SceneNode> Nodes => _order.Select(id => _nodes[id]);

    public Rect Bounds
    {
        get
        {
            if (_nodes.Count == 0) return new Rect(0, 0, 0, 0);
            double l = double.MaxValue, t = double.MaxValue, r = double.MinValue, b = double.MinValue;
            foreach (var n in _nodes.Values)
            {
                l = Math.Min(l, n.Rect.Left); t = Math.Min(t, n.Rect.Top);
                r = Math.Max(r, n.Rect.Right); b = Math.Max(b, n.Rect.Bottom);
            }
            return new Rect(l, t, r - l, b - t);
        }
    }

    public Rect RectOf(string id) => _nodes[id].Rect;

    public void Move(string id, Position position)
    {
        var old = _nodes[id];
        Unindex(old);
        _nodes[id] = Build(old.Element with { Position = position });
        Index(_nodes[id]);
    }

    /// <summary>Every node whose rectangle intersects <paramref name="canvasRect"/>, in document order.</summary>
    public IReadOnlyList<SceneNode> Query(Rect canvasRect)
    {
        var hits = new HashSet<string>();
        var (c0, r0, c1, r1) = CellRange(canvasRect);
        for (var c = c0; c <= c1; c++)
            for (var r = r0; r <= r1; r++)
                if (_cells.TryGetValue((c, r), out var ids))
                    foreach (var id in ids)
                        if (_nodes[id].Rect.Intersects(canvasRect)) hits.Add(id);
        return _order.Where(hits.Contains).Select(id => _nodes[id]).ToList();
    }

    /// <summary>The nodes worth realising for this camera; <paramref name="margin"/> (screen px) keeps a pan from popping boxes in.</summary>
    public IReadOnlyList<SceneNode> Cull(Viewport viewport, double margin = 200) => Query(viewport.VisibleCanvasRect(margin));

    private void Insert(CanvasElement element)
    {
        var node = Build(element);
        _nodes[element.Id] = node;
        _order.Add(element.Id);
        Index(node);
    }

    private SceneNode Build(CanvasElement element)
    {
        var width = element.Size?.W ?? DefaultWidth;
        var height = element.Size?.H ?? UnsizedHeight(element, width);
        var left = ElementRules.IsBottomLeft(element.Render) ? element.Position.X : element.Position.X - width / 2;
        var top = ElementRules.IsBottomLeft(element.Render) ? element.Position.Y - height : element.Position.Y - height / 2;
        return new SceneNode(element, new Rect(left, top, width, height));
    }

    /// <summary>An unsized box grows to fit its description, clamped to a few lines (the layout-engine analogue of a CSS line-clamp).</summary>
    private double UnsizedHeight(CanvasElement element, double width)
    {
        if (_measurer is null || element.Description.Length == 0) return DefaultHeight;
        var text = _measurer.Measure(element.Description, width - TextPadding, FontSize);
        var clamped = Math.Min(text.Height, _measurer.LineHeight * DescriptionLineClamp);
        return Math.Max(DefaultHeight, Chrome + clamped);
    }

    private (int, int, int, int) CellRange(Rect r) =>
        ((int)Math.Floor(r.Left / CellSize), (int)Math.Floor(r.Top / CellSize), (int)Math.Floor(r.Right / CellSize), (int)Math.Floor(r.Bottom / CellSize));

    private void Index(SceneNode node)
    {
        var (c0, r0, c1, r1) = CellRange(node.Rect);
        for (var c = c0; c <= c1; c++)
            for (var r = r0; r <= r1; r++)
            {
                if (!_cells.TryGetValue((c, r), out var list)) _cells[(c, r)] = list = new List<string>();
                list.Add(node.Id);
            }
    }

    private void Unindex(SceneNode node)
    {
        var (c0, r0, c1, r1) = CellRange(node.Rect);
        for (var c = c0; c <= c1; c++)
            for (var r = r0; r <= r1; r++)
                if (_cells.TryGetValue((c, r), out var list)) list.Remove(node.Id);
    }
}
