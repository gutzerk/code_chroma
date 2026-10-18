using System.Globalization;
using Avalonia;
using Avalonia.Media;
using CodeChroma.Canvas.Scene;

namespace CodeChroma.Canvas.Avalonia;

/// <summary>Measures text with Avalonia's text layout, so box height comes from the layout engine instead of CSS line-clamp.</summary>
public sealed class AvaloniaTextMeasurer : ITextMeasurer
{
    private const double ReferenceFontSize = 13;
    private readonly Typeface _typeface = Typeface.Default;

    public double LineHeight => Layout("Ag", 100_000, ReferenceFontSize).Height;

    public TextSize Measure(string text, double maxWidth, double fontSize)
    {
        var layout = Layout(text, maxWidth, fontSize);
        return new TextSize(layout.Width, layout.Height);
    }

    private FormattedText Layout(string text, double maxWidth, double fontSize) =>
        new(text, CultureInfo.InvariantCulture, FlowDirection.LeftToRight, _typeface, fontSize, Brushes.Black)
        {
            MaxTextWidth = double.IsInfinity(maxWidth) ? 0 : Math.Max(1, maxWidth),
        };
}
