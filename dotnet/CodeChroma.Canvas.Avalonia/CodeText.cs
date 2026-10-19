using System.Globalization;
using Avalonia.Media;
using CodeChroma.Canvas.Highlighting;

namespace CodeChroma.Canvas.Avalonia;

/// <summary>The syntax colours shared by the inline code panel and the popup (one palette, dark-on-light like the canvas).</summary>
public static class CodeBrushes
{
    public static IBrush For(TokenKind kind) => kind switch
    {
        TokenKind.Keyword => Brushes.MediumVioletRed,
        TokenKind.String => Brushes.SeaGreen,
        TokenKind.Comment => Brushes.Gray,
        TokenKind.Number => Brushes.DarkOrange,
        _ => Brushes.Black,
    };
}

public static class CodeText
{
    public static readonly FontFamily Mono = new("Consolas, Menlo, Monospace");

    /// <summary>One formatted text for a whole snippet with a foreground range per coloured token.</summary>
    public static FormattedText Format(string language, string text, double fontSize, double maxWidth, double maxHeight)
    {
        var formatted = new FormattedText(text, CultureInfo.InvariantCulture, FlowDirection.LeftToRight, new Typeface(Mono), fontSize, Brushes.Black)
        {
            MaxTextWidth = Math.Max(1, maxWidth),
            MaxTextHeight = Math.Max(1, maxHeight),
        };
        var at = 0;
        foreach (var token in SyntaxHighlighter.Tokenize(language, text))
        {
            if (token.Kind != TokenKind.Plain) formatted.SetForegroundBrush(CodeBrushes.For(token.Kind), at, token.Text.Length);
            at += token.Text.Length;
        }
        return formatted;
    }
}
