using System.Text.RegularExpressions;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Controls.Documents;
using Avalonia.Media;

namespace CodeChroma.Shell.App;

/// <summary>Renders the small markdown subset used by release notes (headings, bullets, bold, links, code) as Avalonia controls.</summary>
public static partial class MarkdownText
{
    public static IEnumerable<Control> Render(string? markdown)
    {
        foreach (var raw in (markdown ?? "").Split('\n'))
        {
            var line = raw.TrimEnd('\r').Trim();
            if (line.Length == 0) continue;
            var heading = HeadingRx().Match(line);
            if (heading.Success)
            {
                var level = heading.Groups[1].Length;
                yield return Block(heading.Groups[2].Value, level <= 2 ? 15 : 13.5, FontWeight.SemiBold, new Thickness(0, 8, 0, 0));
                continue;
            }
            var bullet = BulletRx().Match(line);
            if (bullet.Success) yield return Block("•  " + bullet.Groups[1].Value, 13, FontWeight.Normal, new Thickness(8, 0, 0, 0));
            else yield return Block(line, 13, FontWeight.Normal, default);
        }
    }

    private static TextBlock Block(string text, double size, FontWeight weight, Thickness margin)
    {
        var block = new TextBlock { FontSize = size, FontWeight = weight, TextWrapping = TextWrapping.Wrap, Margin = margin };
        foreach (var run in Inline(text)) block.Inlines!.Add(run);
        return block;
    }

    private static IEnumerable<Run> Inline(string text)
    {
        text = LinkRx().Replace(text, "$1");
        var pos = 0;
        foreach (Match m in EmphasisRx().Matches(text))
        {
            if (m.Index > pos) yield return new Run(text[pos..m.Index]);
            if (m.Groups[1].Success) yield return new Run(m.Groups[1].Value) { FontWeight = FontWeight.Bold };
            else yield return new Run(m.Groups[2].Value) { FontFamily = new FontFamily("Consolas,Menlo,monospace") };
            pos = m.Index + m.Length;
        }
        if (pos < text.Length) yield return new Run(text[pos..]);
    }

    [GeneratedRegex(@"^#{1,6}\s+(.*)$")]
    private static partial Regex HeadingRx();

    [GeneratedRegex(@"^[-*]\s+(.*)$")]
    private static partial Regex BulletRx();

    [GeneratedRegex(@"\[([^\]]+)\]\([^)]*\)")]
    private static partial Regex LinkRx();

    [GeneratedRegex(@"\*\*(.+?)\*\*|`([^`]+)`")]
    private static partial Regex EmphasisRx();
}
