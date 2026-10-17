using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Input;
using Avalonia.Media;
using CodeChroma.Canvas.Collision;
using CodeChroma.Canvas.Hierarchy;
using CodeChroma.Canvas.Model;
using CodeChroma.Canvas.Scene;
using CodeChroma.Canvas.State;
using CodeChroma.Canvas.Tracing;
using Box = CodeChroma.Canvas.Geometry.Box;
using CPoint = CodeChroma.Canvas.Geometry.Point;
using CRect = CodeChroma.Canvas.Geometry.Rect;

namespace CodeChroma.Canvas.Avalonia;

public enum CodeViewMode { Popup, Inline }

/// <summary>
/// The nested expand-in-place hierarchy canvas (Block.tsx + TopLevelChildren.tsx): blocks expand where they sit, the
/// top-level Systems are draggable (solo drops settle clear of neighbours, a multi-selection moves freely), shift-drag
/// draws a rubber band, Ctrl+Z undoes the last move and a code button opens the popup (or an inline panel).
/// </summary>
public sealed class HierarchyView : Control
{
    private enum Mode { None, Pan, PanOrClick, DragOrClick, Marquee }

    public const double CodeButtonSize = 24, CodeButtonInset = 6, DragThresholdPx = 3, CullMarginPx = 200;
    private static readonly string[] UndoKinds = ["hierarchy"];

    private readonly IHierarchySource _source;
    private readonly ICodeSource? _code;
    private readonly AvaloniaTextMeasurer _measurer = new();
    private readonly Dictionary<string, string> _topOf = new();
    private readonly HashSet<string> _marqueeBase = new();
    private HierarchyScene _scene;
    private Mode _mode;
    private Point _pressed, _last;
    private bool _moved, _modifierToggled;
    private HierarchyBox? _pressedBox;
    private Point? _marqueeEnd;

    public HierarchyView(IHierarchySource source, ExpansionState expansion, TopLevelLayoutStore layout, ICodeSource? code = null, UndoHistory? undo = null)
    {
        _source = source;
        _code = code;
        Expansion = expansion;
        Layout = layout;
        Undo = undo ?? new UndoHistory();
        Viewport = new Viewport(new ViewState(20, 20, 1), 800, 600);
        _scene = HierarchyLayout.Compute(source, expansion, _measurer, layout.Positions);
        IndexTops();
        expansion.Changed += Rebuild;
        layout.Changed += Rebuild;
        Selection.Changed += InvalidateVisual;
        ClipToBounds = true;
        Focusable = true;
    }

    public ExpansionState Expansion { get; }
    public TopLevelLayoutStore Layout { get; }
    public UndoHistory Undo { get; }
    public SelectionModel Selection { get; } = new();
    public Viewport Viewport { get; }
    public DragOffsetStore DragOffsets { get; } = new();
    public HierarchyScene Scene => _scene;
    public CodeViewMode CodeMode { get; set; } = CodeViewMode.Popup;
    private TracePlayer? _trace;
    private int _lastFollowedStep = -1;

    /// <summary>The playback to draw over the blocks; the camera follows the active node while its Follow flag is on.</summary>
    public TracePlayer? Trace
    {
        get => _trace;
        set
        {
            if (_trace is not null) _trace.Changed -= OnTraceChanged;
            _trace = value;
            _lastFollowedStep = -1;
            if (_trace is not null) _trace.Changed += OnTraceChanged;
            InvalidateVisual();
        }
    }

    /// <summary>What the trace overlay draws now: framed blocks and caller-to-callee edges, in canvas space.</summary>
    public (IReadOnlyList<TraceNodeMark> Nodes, IReadOnlyList<TraceEdgeMark> Edges) TraceMarks =>
        _trace is { IsActive: true } t
            ? TraceFlow.Compute(t.Trace, t.StepIndex, Expansion.NearestVisibleAncestor, HeaderRect)
            : (Array.Empty<TraceNodeMark>(), Array.Empty<TraceEdgeMark>());

    private CRect? HeaderRect(string id)
    {
        if (_scene.Find(id) is not { } box) return null;
        var r = Offset(box).Rect;
        return new CRect(r.Left, r.Top, r.Width, box.HeaderHeight);
    }

    private void OnTraceChanged()
    {
        if (_trace is { IsActive: true, FollowCamera: true, IsLive: false } t && t.StepIndex != _lastFollowedStep && t.CurrentFrame?.NodeId is { } node)
        {
            _lastFollowedStep = t.StepIndex;
            if (HeaderRect(Expansion.NearestVisibleAncestor(node)) is { } header)
            {
                var at = Viewport.CanvasToScreen(new CPoint(header.CenterX, header.CenterY));
                Viewport.Pan(Viewport.Width / 2 - at.X, Viewport.Height / 2 - at.Y);
            }
        }
        InvalidateVisual();
    }
    public CRect? MarqueeCanvasRect => _mode == Mode.Marquee && _marqueeEnd is { } end ? Marquee.Normalize(Viewport.ScreenToCanvas(new CPoint(_pressed.X, _pressed.Y)), Viewport.ScreenToCanvas(new CPoint(end.X, end.Y))) : null;

    /// <summary>Raised when the code button wants the popup for a node that has source.</summary>
    public event Action<CodeSnippet>? CodeRequested;

    /// <summary>Boxes with a visual for the current camera; deeper levels stay unrealised until their parent opens.</summary>
    public IReadOnlyList<HierarchyBox> RealisedBoxes => CullBoxes();

    /// <summary>The on-screen rectangle (canvas space, including a live drag offset) of a block.</summary>
    public CRect RectOf(string id)
    {
        var box = _scene.Find(id) ?? throw new KeyNotFoundException(id);
        return Offset(box).Rect;
    }

    /// <summary>The code button's canvas rectangle for a block, or null when it has no source to show.</summary>
    public CRect? CodeButtonRect(string id)
    {
        var box = _scene.Find(id);
        if (box is null || !HasCode(box.Item)) return null;
        var r = Offset(box).Rect;
        return new CRect(r.Right - CodeButtonSize - CodeButtonInset, r.Top + CodeButtonInset, CodeButtonSize, CodeButtonSize);
    }

    public static bool HasCode(HierarchyItem item) =>
        item.SourcePath is not null && item.Level is "component" or "service" or "function" or "logic_block";

    /// <summary>Ctrl+Z: restores the top-level positions the last move started from.</summary>
    public bool UndoMove()
    {
        if (Undo.UndoLatest(UndoKinds) is not { } latest) return false;
        Layout.Apply(latest.Layout);
        return true;
    }

    public void FitAll()
    {
        if (_scene.Boxes.Count == 0) return;
        var rects = _scene.TopLevel.Select(b => b.Rect).ToList();
        var l = rects.Min(r => r.Left); var t = rects.Min(r => r.Top);
        var right = rects.Max(r => r.Right); var bottom = rects.Max(r => r.Bottom);
        var fit = Viewport.ComputeFit(new CRect(l, t, right - l, bottom - t));
        Viewport.Pan(fit.X - Viewport.State.X, fit.Y - Viewport.State.Y);
        Viewport.ZoomAround(new CPoint(0, 0), fit.Scale / Viewport.State.Scale);
        InvalidateVisual();
    }

    private void Rebuild()
    {
        _scene = HierarchyLayout.Compute(_source, Expansion, _measurer, Layout.Positions);
        IndexTops();
        Selection.Prune(id => _scene.Find(id) is { Depth: 0 });
        InvalidateVisual();
    }

    private void IndexTops()
    {
        _topOf.Clear();
        foreach (var box in _scene.Boxes) _topOf[box.Id] = box.ParentBoxId is null ? box.Id : _topOf[box.ParentBoxId];
    }

    private (CRect Rect, LiveDragOffset Offset) Offset(HierarchyBox box)
    {
        var o = DragOffsets.All.TryGetValue(_topOf[box.Id], out var off) ? off : default;
        return (new CRect(box.Rect.Left + o.X, box.Rect.Top + o.Y, box.Rect.Width, box.Rect.Height), o);
    }

    private IReadOnlyList<HierarchyBox> CullBoxes()
    {
        var view = Viewport.VisibleCanvasRect(CullMarginPx);
        return _scene.Boxes.Where(b => Offset(b).Rect.Intersects(view)).ToList();
    }

    protected override void OnSizeChanged(SizeChangedEventArgs e)
    {
        base.OnSizeChanged(e);
        Viewport.Width = e.NewSize.Width;
        Viewport.Height = e.NewSize.Height;
        InvalidateVisual();
    }

    private HierarchyBox? HitTest(Point screen)
    {
        var p = Viewport.ScreenToCanvas(new CPoint(screen.X, screen.Y));
        return _scene.Boxes.LastOrDefault(b => Offset(b).Rect is var r && p.X >= r.Left && p.X <= r.Right && p.Y >= r.Top && p.Y <= r.Bottom);
    }

    protected override void OnPointerPressed(PointerPressedEventArgs e)
    {
        base.OnPointerPressed(e);
        if (!e.GetCurrentPoint(this).Properties.IsLeftButtonPressed) return;
        Focus();
        var position = e.GetPosition(this);
        var shift = e.KeyModifiers.HasFlag(KeyModifiers.Shift);
        var ctrl = e.KeyModifiers.HasFlag(KeyModifiers.Control);
        _pressed = _last = position;
        _moved = _modifierToggled = false;
        _pressedBox = HitTest(position);
        if (_pressedBox is null)
        {
            _marqueeBase.Clear();
            if (shift)
            {
                foreach (var id in Selection.Ids) _marqueeBase.Add(id);
                _mode = Mode.Marquee;
            }
            else
            {
                Selection.Clear();
                _mode = Mode.Pan;
            }
        }
        else if (_pressedBox.Depth == 0)
        {
            if (shift || ctrl) { Selection.Toggle(_pressedBox.Id); _modifierToggled = true; }
            _mode = Mode.DragOrClick;
        }
        else _mode = Mode.PanOrClick;
        e.Pointer.Capture(this);
        InvalidateVisual();
    }

    protected override void OnPointerMoved(PointerEventArgs e)
    {
        base.OnPointerMoved(e);
        if (_mode == Mode.None) return;
        var position = e.GetPosition(this);
        if (!_moved && Math.Abs(position.X - _pressed.X) + Math.Abs(position.Y - _pressed.Y) < DragThresholdPx) return;
        if (!_moved)
        {
            _moved = true;
            if (_mode == Mode.PanOrClick) _mode = Mode.Pan;
            else if (_mode == Mode.DragOrClick && !Selection.IsSelected(_pressedBox!.Id)) Selection.Replace([_pressedBox.Id]);
        }
        switch (_mode)
        {
            case Mode.Pan:
                Viewport.Pan(position.X - _last.X, position.Y - _last.Y);
                _last = position;
                break;
            case Mode.DragOrClick:
                var delta = new LiveDragOffset((position.X - _pressed.X) / Viewport.State.Scale, (position.Y - _pressed.Y) / Viewport.State.Scale);
                DragOffsets.SetMany(Selection.Ids.Where(id => _scene.Find(id) is { Depth: 0 }).ToDictionary(id => id, _ => delta));
                break;
            case Mode.Marquee:
                _marqueeEnd = position;
                var hits = Marquee.Hits(MarqueeCanvasRect!.Value, CullBoxes().Where(b => b.Depth == 0).Select(b => (b.Id, Offset(b).Rect)));
                Selection.Replace(_marqueeBase.Concat(hits));
                break;
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
        if (mode == Mode.DragOrClick && _moved) CommitDrag(e.GetPosition(this));
        else if (!_moved && _pressedBox is not null && !_modifierToggled && mode is Mode.DragOrClick or Mode.PanOrClick)
            Click(_pressedBox, e.GetPosition(this));
        DragOffsets.Reset();
        InvalidateVisual();
    }

    private void Click(HierarchyBox box, Point screen)
    {
        var canvas = Viewport.ScreenToCanvas(new CPoint(screen.X, screen.Y));
        if (CodeButtonRect(box.Id) is { } button && canvas.X >= button.Left && canvas.X <= button.Right && canvas.Y >= button.Top && canvas.Y <= button.Bottom)
        {
            RequestCode(box.Item);
            return;
        }
        Selection.Clear();
        if (box.CodeOpen) return;
        if (box.Item.HasChildren || !string.IsNullOrEmpty(box.Item.Description)) Expansion.Toggle(box.Id);
    }

    private void RequestCode(HierarchyItem item)
    {
        if (CodeMode == CodeViewMode.Inline) { Expansion.ToggleCode(item.Id); return; }
        if (_code?.Get(item.Id) is { } snippet) CodeRequested?.Invoke(snippet with { Params = item.Params });
    }

    protected override void OnPointerWheelChanged(PointerWheelEventArgs e)
    {
        base.OnPointerWheelChanged(e);
        var factor = e.Delta.Y > 0 ? Viewport.ButtonZoomStep : 1 / Viewport.ButtonZoomStep;
        var position = e.GetPosition(this);
        Viewport.ZoomAround(new CPoint(position.X, position.Y), factor);
        InvalidateVisual();
    }

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.Key == Key.Escape) { Selection.Clear(); e.Handled = true; }
        else if (e.Key == Key.Z && (e.KeyModifiers.HasFlag(KeyModifiers.Control) || e.KeyModifiers.HasFlag(KeyModifiers.Meta))) e.Handled = UndoMove();
    }

    private void CommitDrag(Point release)
    {
        var tops = Selection.Ids.Where(id => _scene.Find(id) is { Depth: 0 }).ToList();
        if (tops.Count == 0) return;
        var dx = (release.X - _pressed.X) / Viewport.State.Scale;
        var dy = (release.Y - _pressed.Y) / Viewport.State.Scale;
        if (tops.Count == 1)
        {
            var start = _scene.Find(tops[0])!.Rect;
            var moving = new Box(start.Left + dx, start.Top + dy, start.Width, start.Height);
            var obstacles = _scene.TopLevel.Where(b => b.Id != tops[0]).Select(b => new Obstacle(b.Id, new Box(b.Rect.Left, b.Rect.Top, b.Rect.Width, b.Rect.Height))).ToList();
            var landing = DropResolver.Resolve(moving, obstacles);
            dx = landing.X - start.Left;
            dy = landing.Y - start.Top;
        }
        var before = tops.ToDictionary(id => id, id => new Position(_scene.Find(id)!.Rect.Left, _scene.Find(id)!.Rect.Top));
        Undo.Record("hierarchy", before);
        Layout.Apply(tops.ToDictionary(id => id, id => new Position(before[id].X + dx, before[id].Y + dy)));
    }

    private static IBrush Accent(string level) => level switch
    {
        "system" => Brushes.SteelBlue,
        "pillar" => Brushes.MediumPurple,
        "component" => Brushes.SeaGreen,
        "service" => Brushes.DarkCyan,
        "function" => Brushes.Chocolate,
        _ => Brushes.Gray,
    };

    public override void Render(DrawingContext context)
    {
        context.FillRectangle(Brushes.Transparent, new Rect(Bounds.Size));
        var m = Viewport.Matrix;
        using var _ = context.PushTransform(new Matrix(m.M11, m.M12, m.M21, m.M22, m.M31, m.M32));
        var typeface = Typeface.Default;
        foreach (var box in CullBoxes())
        {
            var cr = Offset(box).Rect;
            var r = new Rect(cr.Left, cr.Top, cr.Width, cr.Height);
            var selected = Selection.IsSelected(box.Id);
            var fill = box.Item.DocOnly ? Brushes.WhiteSmoke : Brushes.White;
            context.DrawRectangle(fill, new Pen(selected ? Brushes.DodgerBlue : Accent(box.Item.Level), selected ? 2.5 : 1.2), r, 8, 8);
            DrawHeader(context, box, r, typeface);
            if (box.CodeOpen && _code?.Get(box.Id) is { } snippet)
            {
                var body = new Rect(r.X + 8, r.Y + box.HeaderHeight, r.Width - 16, r.Height - box.HeaderHeight - 8);
                using (context.PushClip(body))
                    context.DrawText(CodeText.Format(snippet.Language, snippet.Text, 11, body.Width, body.Height), body.TopLeft);
            }
        }
        var (traceNodes, traceEdges) = TraceMarks;
        foreach (var edge in traceEdges)
            context.DrawLine(new Pen(edge.Error ? Brushes.Firebrick : Brushes.DarkOrange, edge.Active ? 3 : 1.5), new Point(edge.From.X, edge.From.Y), new Point(edge.To.X, edge.To.Y));
        foreach (var mark in traceNodes)
            context.DrawRectangle(null, new Pen(mark.Error ? Brushes.Firebrick : Brushes.DarkOrange, mark.Active ? 3 : 1.2), new Rect(mark.Frame.Left, mark.Frame.Top, mark.Frame.Width, mark.Frame.Height), 8, 8);
        if (MarqueeCanvasRect is { } band)
            context.DrawRectangle(new SolidColorBrush(Color.FromArgb(0x30, 0x1E, 0x90, 0xFF)), new Pen(Brushes.DodgerBlue, 1), new Rect(band.Left, band.Top, band.Width, band.Height));
    }

    private void DrawHeader(DrawingContext context, HierarchyBox box, Rect r, Typeface typeface)
    {
        var item = box.Item;
        var glyph = item.HasChildren ? (box.Expanded ? "v " : "> ") : "";
        var reserve = HasCode(item) ? CodeButtonSize + CodeButtonInset * 2 : 12;
        var width = Math.Max(1, r.Width - 24 - reserve);
        var title = new FormattedText(glyph + item.Name, CultureInfo.InvariantCulture, FlowDirection.LeftToRight, new Typeface(typeface.FontFamily, FontStyle.Normal, FontWeight.SemiBold), 13, Brushes.Black)
        { MaxTextWidth = width, MaxTextHeight = HierarchyLayout.NameLine };
        context.DrawText(title, new Point(r.X + 12, r.Y + HierarchyLayout.HeaderTop));
        var y = r.Y + HierarchyLayout.HeaderTop + HierarchyLayout.NameLine;
        if (item.Params is not null)
        {
            context.DrawText(new FormattedText(item.Params, CultureInfo.InvariantCulture, FlowDirection.LeftToRight, typeface, 11, Brushes.Gray) { MaxTextWidth = width, MaxTextHeight = HierarchyLayout.ParamsLine }, new Point(r.X + 12, y));
            y += HierarchyLayout.ParamsLine;
        }
        if (box.Expanded && !string.IsNullOrEmpty(item.Description))
            context.DrawText(new FormattedText(item.Description, CultureInfo.InvariantCulture, FlowDirection.LeftToRight, typeface, 12, Brushes.DimGray) { MaxTextWidth = r.Width - 24, MaxTextHeight = Math.Max(1, box.HeaderHeight - (y - r.Y) - 4) }, new Point(r.X + 12, y + 4));
        if (CodeButtonRect(box.Id) is { } b)
        {
            var br = new Rect(b.Left, b.Top, b.Width, b.Height);
            context.DrawRectangle(Brushes.WhiteSmoke, new Pen(Brushes.Gray, 1), br, 4, 4);
            context.DrawText(new FormattedText("</>", CultureInfo.InvariantCulture, FlowDirection.LeftToRight, new Typeface(CodeText.Mono), 10, Brushes.DimGray), new Point(br.X + 2, br.Y + 5));
        }
    }
}
