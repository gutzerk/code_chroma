using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;
using Avalonia.VisualTree;
using CodeChroma.Canvas.Collision;
using CodeChroma.Canvas.Connectors;
using CodeChroma.Canvas.Model;
using CodeChroma.Canvas.Scene;
using CodeChroma.Canvas.State;
using Box = CodeChroma.Canvas.Geometry.Box;
using AvGeometry = Avalonia.Media.Geometry;
using CPoint =CodeChroma.Canvas.Geometry.Point;
using CRect = CodeChroma.Canvas.Geometry.Rect;

namespace CodeChroma.Canvas.Avalonia;

/// <summary>
/// The thin view: draws only the culled slice of the model-owned scene through one viewport matrix, and turns pointer
/// input into model operations (pan, wheel zoom, selection, collision-resolved drag). It owns no geometry of its own.
/// </summary>
public sealed class CanvasView : Control
{
    private enum Mode { None, Pan, Drag, Marquee }

    private const double CullMarginPx = 200;
    private const double DragThresholdPx = 3;

    private readonly CanvasDocStore _store;
    private readonly ICanvasBridge _bridge;
    private readonly AvaloniaTextMeasurer _measurer = new();
    private readonly HashSet<string> _marqueeBase = new();
    private Point? _marqueeEnd;
    private SceneGraph _scene;
    private List<RoutedEdge<CanvasEdge>>? _routed;
    private string _routedSignature = "";
    private Mode _mode;
    private Point _pressed;
    private Point _last;
    private bool _moved;
    private string? _pressedOn;
    private bool _pressedWasSelected;

    public CanvasView(CanvasDocStore store, ICanvasBridge bridge)
    {
        _store = store;
        _bridge = bridge;
        Viewport = new Viewport(new ViewState(0, 0, 1), 800, 600);
        _scene = new SceneGraph(store.Doc, _measurer);
        SelectionModel.Changed += InvalidateVisual;
        ClipToBounds = true;
        Focusable = true;
    }

    public Viewport Viewport { get; }
    public SceneGraph Scene => _scene;
    public SelectionModel SelectionModel { get; } = new();
    public IReadOnlyCollection<string> Selection => SelectionModel.Ids;
    public UndoHistory Undo { get; } = new();

    /// <summary>The rubber band in canvas space while a shift-drag is in progress.</summary>
    public CRect? MarqueeCanvasRect => _mode == Mode.Marquee && _marqueeEnd is { } end
        ? Marquee.Normalize(Viewport.ScreenToCanvas(new CPoint(_pressed.X, _pressed.Y)), Viewport.ScreenToCanvas(new CPoint(end.X, end.Y)))
        : null;
    public DragOffsetStore DragOffsets { get; } = new();

    /// <summary>The ids of the boxes realised for the current camera (everything else has no visual at all).</summary>
    public IReadOnlyList<string> RealisedIds => _scene.Cull(Viewport, CullMarginPx).Select(n => n.Id).ToList();

    /// <summary>Edges with at least one realised end, routed around the realised boxes; cached until the scene or the realised set changes.</summary>
    public IReadOnlyList<RoutedEdge<CanvasEdge>> RoutedEdges
    {
        get
        {
            var realised = _scene.Cull(Viewport, CullMarginPx);
            var ids = realised.Select(n => n.Id).ToHashSet();
            var signature = string.Join("|", ids.OrderBy(i => i, StringComparer.Ordinal));
            if (_routed is not null && signature == _routedSignature) return _routed;
            var edges = _store.Doc.Edges.Values
                .Where(e => (ids.Contains(e.From) || ids.Contains(e.To)) && _store.Doc.Elements.ContainsKey(e.From) && _store.Doc.Elements.ContainsKey(e.To))
                .ToList();
            _routed = EdgeRouter.Route(
                edges, e => OrthogonalRoute.PairKeyOf(e.From, e.To),
                e => new RoutedEndpoints(_scene.RectOf(e.From), _scene.RectOf(e.To), e.From, e.To),
                realised.Select(n => n.Rect).ToList()).ToList();
            _routedSignature = signature;
            return _routed;
        }
    }

    protected override void OnAttachedToVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnAttachedToVisualTree(e);
        _store.Changed += OnStoreChanged;
        OnStoreChanged();
    }

    protected override void OnDetachedFromVisualTree(VisualTreeAttachmentEventArgs e)
    {
        base.OnDetachedFromVisualTree(e);
        _store.Changed -= OnStoreChanged;
    }

    private void OnStoreChanged() => UiThread.Run(ApplyStore);

    private void ApplyStore()
    {
        _scene = new SceneGraph(_store.Doc, _measurer);
        SelectionModel.Prune(id => _store.Doc.Elements.ContainsKey(id));
        _routed = null;
        InvalidateVisual();
    }

    protected override void OnSizeChanged(SizeChangedEventArgs e)
    {
        base.OnSizeChanged(e);
        Viewport.Width = e.NewSize.Width;
        Viewport.Height = e.NewSize.Height;
        InvalidateVisual();
    }

    private string? HitTest(Point screen)
    {
        var p = Viewport.ScreenToCanvas(new CPoint(screen.X, screen.Y));
        return _scene.Query(new CRect(p.X, p.Y, 0.02, 0.02)).LastOrDefault()?.Id;
    }

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) return;
        var position = e.GetPosition(this);
        var ctrl = e.KeyModifiers.HasFlag(KeyModifiers.Control);
        _pressed = _last = position;
        _moved = false;
        _pressedOn = HitTest(position);
        if (_pressedOn is null)
        {
            _marqueeBase.Clear();
            if (e.KeyModifiers.HasFlag(KeyModifiers.Shift))
            {
                foreach (var id in SelectionModel.Ids) _marqueeBase.Add(id);
                _mode = Mode.Marquee;
            }
            else
            {
                if (!ctrl) SelectionModel.Clear();
                _mode = Mode.Pan;
            }
        }
        else
        {
            _pressedWasSelected = SelectionModel.IsSelected(_pressedOn);
            if (ctrl || e.KeyModifiers.HasFlag(KeyModifiers.Shift)) SelectionModel.Toggle(_pressedOn);
            else if (!_pressedWasSelected) SelectionModel.Replace([_pressedOn]);
            _mode = Mode.Drag;
        }
        e.Pointer.Capture(this);
        InvalidateVisual();
    }

    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);
        if (_mode == Mode.None) return;
        var position = e.GetPosition(this);
        if (!_moved && Math.Abs(position.X - _pressed.X) + Math.Abs(position.Y - _pressed.Y) < DragThresholdPx) return;
        _moved = true;
        if (_mode == Mode.Pan)
        {
            Viewport.Pan(position.X - _last.X, position.Y - _last.Y);
            _last = position;
        }
        else if (_mode == Mode.Marquee)
        {
            _marqueeEnd = position;
            var hits = Marquee.Hits(MarqueeCanvasRect!.Value, _scene.Cull(Viewport, CullMarginPx).Select(n => (n.Id, n.Rect)));
            SelectionModel.Replace(_marqueeBase.Concat(hits));
        }
        else
        {
            var delta = new LiveDragOffset((position.X - _pressed.X) / Viewport.State.Scale, (position.Y - _pressed.Y) / Viewport.State.Scale);
            DragOffsets.SetMany(DraggableSelection().ToDictionary(id => id, _ => delta));
        }
        InvalidateVisual();
    }

    protected override void OnPointerReleased(PointerReleasedEventArgs e)
    {
        base.OnPointerReleased(e);
        e.Pointer.Capture(null);
        var mode = _mode;
        _mode = Mode.None;
        _marqueeEnd = null;
        if (mode == Mode.Drag)
        {
            if (_moved) CommitDrag(e.GetPosition(this));
            else if (_pressedWasSelected && _pressedOn is not null && !e.KeyModifiers.HasFlag(KeyModifiers.Control) && !e.KeyModifiers.HasFlag(KeyModifiers.Shift))
                SelectionModel.Replace([_pressedOn]);
        }
        DragOffsets.Reset();
        InvalidateVisual();
    }

    protected override void OnPointerWheelChanged(PointerWheelEventArgs e)
    {
        base.OnPointerWheelChanged(e);
        var factor = e.Delta.Y > 0 ? Viewport.ButtonZoomStep : 1 / Viewport.ButtonZoomStep;
        var position = e.GetPosition(this);
        Viewport.ZoomAround(new CPoint(position.X, position.Y), factor);
        InvalidateVisual();
    }

    private IEnumerable<string> DraggableSelection() =>
        SelectionModel.Ids.Where(id => _store.Doc.Elements.TryGetValue(id, out var el) && !ElementRules.For(el.Render).LockedLayout);

    private void CommitDrag(Point release)
    {
        var ids = DraggableSelection().ToList();
        if (ids.Count == 0) return;
        var dx = (release.X - _pressed.X) / Viewport.State.Scale;
        var dy = (release.Y - _pressed.Y) / Viewport.State.Scale;

        if (ids.Count == 1)
        {
            var start = _scene.RectOf(ids[0]);
            var moving = new Box(start.Left + dx, start.Top + dy, start.Width, start.Height);
            var near = _scene.Query(new CRect(moving.X - 400, moving.Y - 400, moving.Width + 800, moving.Height + 800));
            var obstacles = near.Where(n => n.Id != ids[0]).Select(n => new Obstacle(n.Id, new Box(n.Rect.Left, n.Rect.Top, n.Rect.Width, n.Rect.Height))).ToList();
            var landing = DropResolver.Resolve(moving, obstacles);
            dx = landing.X - start.Left;
            dy = landing.Y - start.Top;
        }

        var positions = ids.ToDictionary(id => id, id =>
        {
            var p = _store.Doc.Elements[id].Position;
            return new Position(p.X + dx, p.Y + dy);
        });
        var before = ids.ToDictionary(id => id, id => _store.Doc.Elements[id].Position);
        _ = CommitPositionsAsync(positions, before);
    }

    private async Task CommitPositionsAsync(IReadOnlyDictionary<string, Position> positions, IReadOnlyDictionary<string, Position> before)
    {
        if (await _store.ApplyCanvasPositionsAsync(_bridge, positions)) Undo.Record("canvas", before);
    }

    private async Task UndoPositionsAsync(IReadOnlyDictionary<string, Position> layout)
    {
        if (!await _store.ApplyCanvasPositionsAsync(_bridge, layout)) Undo.Record("canvas", layout);
    }

    /// <summary>Ctrl+Z: puts the last moved boxes back where the move started (not itself recorded).</summary>
    public bool UndoMove()
    {
        if (Undo.UndoLatest(new[] { "canvas" }) is not { } latest) return false;
        _ = UndoPositionsAsync(latest.Layout);
        return true;
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.Key == Key.Escape) { SelectionModel.Clear(); e.Handled = true; }
        else if (e.Key == Key.Z && (e.KeyModifiers.HasFlag(KeyModifiers.Control) || e.KeyModifiers.HasFlag(KeyModifiers.Meta))) e.Handled = UndoMove();
    }

    public override void Render(DrawingContext context)
    {
        context.FillRectangle(Brushes.Transparent, new Rect(Bounds.Size));
        var m = Viewport.Matrix;
        using var _ = context.PushTransform(new Matrix(m.M11, m.M12, m.M21, m.M22, m.M31, m.M32));

        var edgePen = new Pen(Brushes.Gray, 1.5);
        foreach (var edge in RoutedEdges)
        {
            try { context.DrawGeometry(null, edgePen, AvGeometry.Parse(edge.Route.D)); }
            catch (FormatException) { /* a degenerate route draws nothing */ }
        }

        var typeface = Typeface.Default;
        foreach (var node in _scene.Cull(Viewport, CullMarginPx))
        {
            var offset = DragOffsets.All.TryGetValue(node.Id, out var o) ? o : default;
            var r = new Rect(node.Rect.Left + offset.X, node.Rect.Top + offset.Y, node.Rect.Width, node.Rect.Height);
            var selected = SelectionModel.IsSelected(node.Id);
            context.DrawRectangle(Brushes.White, new Pen(selected ? Brushes.DodgerBlue : Brushes.DimGray, selected ? 2 : 1), r, 6, 6);
            var title = new FormattedText(node.Element.Label, CultureInfo.InvariantCulture, FlowDirection.LeftToRight, typeface, 14, Brushes.Black)
            {
                MaxTextWidth = Math.Max(1, r.Width - 16),
                MaxTextHeight = Math.Max(1, r.Height - 8),
            };
            context.DrawText(title, new Point(r.X + 8, r.Y + 6));
        }
        if (MarqueeCanvasRect is { } band)
            context.DrawRectangle(new SolidColorBrush(Color.FromArgb(0x30, 0x1E, 0x90, 0xFF)), new Pen(Brushes.DodgerBlue, 1), new Rect(band.Left, band.Top, band.Width, band.Height));
    }
}
