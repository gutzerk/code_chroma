using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Input;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.VisualTree;
using CodeChroma.Canvas.Hierarchy;
using CodeChroma.Canvas.Diff;
using CodeChroma.Canvas.Highlighting;

namespace CodeChroma.Canvas.Avalonia;

/// <summary>
/// The full-viewport code overlay (port of CodePopup.tsx): a backdrop and a panel with a draggable title bar, the
/// syntax-highlighted source, a close button and a corner resize handle. Escape and a backdrop click close it.
/// </summary>
public sealed class CodePopup : Grid
{
    public const double DefaultWidth = 720, DefaultHeight = 460, MinPanelWidth = 320, MinPanelHeight = 180, DragThresholdPx = 3;

    private readonly TranslateTransform _shift = new();
    private Point _gesture;
    private Point _shiftAtStart;
    private Size _sizeAtStart;
    private bool _dragging, _resizing, _moved;

    public CodePopup(CodeSnippet snippet, FunctionDiff? diff = null, Func<Task<bool>>? accept = null)
    {
        Snippet = snippet;
        Diff = diff;
        Focusable = true;
        Backdrop = new Border { Background = new SolidColorBrush(Color.FromArgb(0x66, 0, 0, 0)) };
        Backdrop.PointerPressed += (_, e) => { if (ReferenceEquals(e.Source, Backdrop)) Close(); };

        TitleText = new TextBlock { Text = TitleOf(snippet), FontWeight = FontWeight.SemiBold, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(10, 0) };
        CloseButton = new Button { Content = "x", Width = 28, Height = 24, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(4) };
        CloseButton.Click += (_, _) => Close();
        var titleGrid = new Grid { Children = { TitleText, CloseButton } };
        if (diff is not null && accept is not null)
        {
            AcceptButton = new Button { Content = "Accept", Height = 24, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 4, 40, 4) };
            AcceptButton.Click += async (_, _) =>
            {
                AcceptButton.IsEnabled = false;
                AcceptButton.Content = "Accepting...";
                var ok = await accept();
                if (ok) Close();
                else { AcceptButton.IsEnabled = true; AcceptButton.Content = "Accept"; }
            };
            titleGrid.Children.Add(AcceptButton);
        }
        TitleBar = new Border { Background = Brushes.WhiteSmoke, Child = titleGrid, Height = 32 };
        TitleBar.PointerPressed += OnTitlePressed;
        TitleBar.PointerMoved += OnTitleMoved;
        TitleBar.PointerReleased += (_, e) => { _dragging = false; e.Pointer.Capture(null); };

        SourceBlock = new TextBlock { FontFamily = CodeText.Mono, FontSize = 13, Margin = new Thickness(10), TextWrapping = TextWrapping.NoWrap };
        FillSource();
        var scroller = new ScrollViewer { Content = SourceBlock, HorizontalScrollBarVisibility = global::Avalonia.Controls.Primitives.ScrollBarVisibility.Auto };

        ResizeHandle = new Border { Width = 16, Height = 16, Background = Brushes.Gainsboro, HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom, Cursor = new Cursor(StandardCursorType.BottomRightCorner) };
        ResizeHandle.PointerPressed += OnResizePressed;
        ResizeHandle.PointerMoved += OnResizeMoved;
        ResizeHandle.PointerReleased += (_, e) => { _resizing = false; e.Pointer.Capture(null); };

        var content = new Grid { RowDefinitions = new RowDefinitions("Auto,*") };
        Grid.SetRow(scroller, 1);
        content.Children.Add(TitleBar);
        content.Children.Add(scroller);
        content.Children.Add(ResizeHandle);
        Grid.SetRow(ResizeHandle, 1);

        Panel = new Border
        {
            Width = DefaultWidth, Height = DefaultHeight, Background = Brushes.White, BorderBrush = Brushes.DimGray, BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8), HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
            RenderTransform = _shift, ClipToBounds = true, Child = content,
        };
        Panel.PointerPressed += (_, e) => e.Handled = true;
        Children.Add(Backdrop);
        Children.Add(Panel);
    }

    public CodeSnippet Snippet { get; }
    public FunctionDiff? Diff { get; }
    public Button? AcceptButton { get; }
    public Border Backdrop { get; }
    public Border Panel { get; }
    public Border TitleBar { get; }
    public TextBlock TitleText { get; }
    public Button CloseButton { get; }
    public TextBlock SourceBlock { get; }
    public Border ResizeHandle { get; }

    /// <summary>How far the title-bar drag has moved the panel from the centre.</summary>
    public Point Shift => new(_shift.X, _shift.Y);

    public event Action? Closed;

    public void Close() => Closed?.Invoke();

    protected override void OnKeyDown(KeyEventArgs e)
    {
        base.OnKeyDown(e);
        if (e.Key == Key.Escape) { Close(); e.Handled = true; }
    }

    private static string TitleOf(CodeSnippet s) => s.Params is { Length: > 0 } p ? $"{s.Title}({p})" : s.Title;

    private void FillSource()
    {
        SourceBlock.Inlines!.Clear();
        if (Diff is not null)
        {
            var lines = LineDiff.Compute(Diff.OriginalSource, Diff.ProposedSource);
            for (var i = 0; i < lines.Count; i++)
            {
                var kind = lines[i].Kind;
                SourceBlock.Inlines.Add(new Run($"{lines[i].Marker} {lines[i].Text}" + (i < lines.Count - 1 ? "\n" : ""))
                {
                    Background = DiffBrushes.For(kind),
                    Foreground = Brushes.Black,
                });
            }
            return;
        }
        foreach (var token in SyntaxHighlighter.Tokenize(Snippet.Language, Snippet.Text))
            SourceBlock.Inlines.Add(new Run(token.Text) { Foreground = CodeBrushes.For(token.Kind) });
    }

    private void OnTitlePressed(object? sender, PointerPressedEventArgs e)
    {
        if (e.Source is Visual v && (v is Button || v.FindAncestorOfType<Button>() is not null)) return;
        _dragging = true;
        _moved = false;
        _gesture = e.GetPosition(this);
        _shiftAtStart = new Point(_shift.X, _shift.Y);
        e.Pointer.Capture(TitleBar);
    }

    private void OnTitleMoved(object? sender, PointerEventArgs e)
    {
        if (!_dragging) return;
        var delta = e.GetPosition(this) - _gesture;
        if (!_moved && Math.Abs(delta.X) + Math.Abs(delta.Y) < DragThresholdPx) return;
        _moved = true;
        _shift.X = _shiftAtStart.X + delta.X;
        _shift.Y = _shiftAtStart.Y + delta.Y;
    }

    private void OnResizePressed(object? sender, PointerPressedEventArgs e)
    {
        _resizing = true;
        _gesture = e.GetPosition(this);
        _sizeAtStart = new Size(Panel.Width, Panel.Height);
        e.Pointer.Capture(ResizeHandle);
        e.Handled = true;
    }

    private void OnResizeMoved(object? sender, PointerEventArgs e)
    {
        if (!_resizing) return;
        var delta = e.GetPosition(this) - _gesture;
        Panel.Width = Math.Max(MinPanelWidth, _sizeAtStart.Width + delta.X);
        Panel.Height = Math.Max(MinPanelHeight, _sizeAtStart.Height + delta.Y);
    }
}

public static class DiffBrushes
{
    public static IBrush For(DiffLineKind kind) => kind switch
    {
        DiffLineKind.Added => new SolidColorBrush(Color.FromRgb(0xD4, 0xF4, 0xDD)),
        DiffLineKind.Removed => new SolidColorBrush(Color.FromRgb(0xF8, 0xD7, 0xDA)),
        _ => Brushes.Transparent,
    };

    /// <summary>The block-recolor border for a node's change status.</summary>
    public static IBrush Border(string status) => status switch
    {
        "added" => Brushes.SeaGreen,
        "modified" => Brushes.DarkOrange,
        "removed" => Brushes.Firebrick,
        _ => Brushes.Gray,
    };
}
