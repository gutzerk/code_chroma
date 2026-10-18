using System.Numerics;

namespace CodeChroma.Canvas.Scene;

/// <summary>The camera: screen = canvas * Scale + (X, Y).</summary>
public readonly record struct ViewState(double X, double Y, double Scale);

/// <summary>
/// A single-matrix camera (replaces CanvasViewport.tsx's CSS transform plus DOM-measured fitting). Because boxes live in
/// the model, fitting and culling are pure math over canvas rects.
/// </summary>
public sealed class Viewport
{
    public const double MinScale = 0.25, MaxScale = 2.5, ButtonZoomStep = 1.12;
    /// <summary>A focus action may zoom in further than manual zoom ever does.</summary>
    public const double FocusMaxScale = 3.5, FocusFitPadding = 0.7;

    private ViewState _state;

    public Viewport(ViewState state, double width, double height)
    {
        _state = state;
        Width = width;
        Height = height;
    }

    public double Width { get; set; }
    public double Height { get; set; }

    public ViewState State
    {
        get => _state;
        set => _state = value;
    }

    /// <summary>Canvas to screen as a matrix, for a renderer that applies one transform to the whole scene.</summary>
    public Matrix3x2 Matrix => Matrix3x2.CreateScale((float)_state.Scale) * Matrix3x2.CreateTranslation((float)_state.X, (float)_state.Y);

    /// <summary>Zooms by <paramref name="factor"/> keeping the canvas point under <paramref name="cursor"/> fixed.</summary>
    public void ZoomAround(Point cursor, double factor)
    {
        var scale = Math.Clamp(_state.Scale * factor, MinScale, MaxScale);
        _state = new ViewState(
            cursor.X - (cursor.X - _state.X) / _state.Scale * scale,
            cursor.Y - (cursor.Y - _state.Y) / _state.Scale * scale,
            scale);
    }

    public void Pan(double dx, double dy) => _state = _state with { X = _state.X + dx, Y = _state.Y + dy };

    public Point CanvasToScreen(Point p) => new(p.X * _state.Scale + _state.X, p.Y * _state.Scale + _state.Y);

    public Point ScreenToCanvas(Point p) => new((p.X - _state.X) / _state.Scale, (p.Y - _state.Y) / _state.Scale);

    /// <summary>The canvas rectangle currently on screen, grown by a margin given in screen pixels.</summary>
    public Rect VisibleCanvasRect(double marginPx = 0)
    {
        var margin = marginPx / _state.Scale;
        return new Rect(
            -_state.X / _state.Scale - margin, -_state.Y / _state.Scale - margin,
            Width / _state.Scale + margin * 2, Height / _state.Scale + margin * 2);
    }

    /// <summary>The view that centres <paramref name="canvasRect"/> and fills it with padding (computeFitView, minus the DOM).</summary>
    public ViewState ComputeFit(Rect canvasRect) => ComputeFit(canvasRect, FocusMaxScale);

    /// <summary>Same fit with a caller-chosen scale ceiling, e.g. <see cref="MaxScale"/> for a manual fit-all.</summary>
    public ViewState ComputeFit(Rect canvasRect, double maxScale)
    {
        var fit = Math.Min(Width / canvasRect.Width, Height / canvasRect.Height);
        var scale = Math.Clamp(fit * FocusFitPadding, MinScale, maxScale);
        return new ViewState(
            Width / 2 - canvasRect.CenterX * scale,
            Height / 2 - canvasRect.CenterY * scale,
            scale);
    }
}
