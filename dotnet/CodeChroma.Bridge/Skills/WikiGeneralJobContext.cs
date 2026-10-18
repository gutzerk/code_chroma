using System.Text.RegularExpressions;
using CodeChroma.Bridge.Wiki;
using CodeChroma.Core.Wiki;

namespace CodeChroma.Bridge.Skills;

/// <summary>The plain-wiki context wiki-general's own worker jobs read: no navigation, one sentence each (wiki_general_job_context.py).</summary>
public static partial class WikiGeneralJobContext
{
    private static readonly HashSet<string> Abbreviations = ["e.g", "i.e", "etc", "vs", "cf", "approx"];

    [GeneratedRegex(@"^(#{1,6})\s")]
    private static partial Regex HeaderRe();

    [GeneratedRegex("^- `([^`]+)` — (.*)$")]
    private static partial Regex BulletRe();

    [GeneratedRegex(@"[.!?]+(?=\s|$)")]
    private static partial Regex SentenceEndRe();

    // Letters with optional internal dots, so a lookback before the cut sees "e.g" whole, not just "g".
    [GeneratedRegex(@"([a-zA-Z]+(?:\.[a-zA-Z]+)*)$")]
    private static partial Regex AbbrevTailRe();

    /// <summary>The first real sentence in the text: cuts at ./!/?, skipping "e.g."-style abbreviations.</summary>
    public static string FirstSentence(string text)
    {
        foreach (Match match in SentenceEndRe().Matches(text))
        {
            var tail = AbbrevTailRe().Match(text[..match.Index]);
            if (tail.Success && Abbreviations.Contains(tail.Groups[1].Value.ToLowerInvariant())) continue;
            return text[..(match.Index + match.Length)];
        }
        return text;
    }

    private static bool IsBoundary(string line) => HeaderRe().IsMatch(line) || BulletRe().IsMatch(line) || line.Trim() == WikiWriter.NoBreakdown;

    private static (List<string> Body, int Next) CollectBody(List<string> lines, int start)
    {
        var body = new List<string>();
        var j = start;
        while (j < lines.Count && !IsBoundary(lines[j]))
        {
            body.Add(lines[j]);
            j++;
        }
        return (body, j);
    }

    /// <summary>Reduces every module/class/bullet docstring in a rendered wiki file page to one sentence.</summary>
    public static string TrimToFirstSentence(string markdown)
    {
        var lines = markdown.Split('\n').ToList();
        var output = new List<string>();
        var i = 0;
        while (i < lines.Count)
        {
            var line = lines[i];
            var bullet = BulletRe().Match(line);
            if (bullet.Success)
            {
                var (body, next) = CollectBody(lines, i + 1);
                var doc = FirstSentence(string.Join('\n', [bullet.Groups[2].Value, .. body]).Trim());
                output.Add($"- `{bullet.Groups[1].Value}` — {doc}");
                i = next;
                continue;
            }
            var header = HeaderRe().Match(line);
            if (header.Success && header.Groups[1].Value is "#" or "###")
            {
                output.Add(line);
                var (body, next) = CollectBody(lines, i + 1);
                var text = string.Join('\n', body).Trim();
                if (text.Length > 0)
                {
                    output.Add("");
                    output.Add(FirstSentence(text));
                }
                i = next;
                continue;
            }
            output.Add(line);
            i++;
        }
        return string.Join('\n', output);
    }

    /// <summary>Each path's own file page, one-sentence-trimmed: no root index, no ancestor-folder walk.</summary>
    public static WikiContextBundle Build(string wikiDir, IReadOnlyList<string> paths)
    {
        if (Routes.SourceText.Read(Path.Combine(wikiDir, "index.md")) is null) return WikiContextBundle.Missing;
        var budget = new CharBudget(WikiContext.MaxChars);
        var pages = new List<WikiContextPage>();
        var gaps = new List<string>();
        foreach (var path in paths)
        {
            if (budget.Truncated) break;
            if (WikiContext.SafeFileText(wikiDir, path) is not { } raw)
            {
                gaps.Add(path);
                continue;
            }
            var content = TrimToFirstSentence(raw);
            if (!budget.TryAdd(content)) break;
            pages.Add(new WikiContextPage(path, "file", content));
        }
        return new WikiContextBundle(true, null, pages, gaps, budget.Truncated);
    }
}
