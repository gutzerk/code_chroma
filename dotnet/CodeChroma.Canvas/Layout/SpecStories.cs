using System.Text.RegularExpressions;

namespace CodeChroma.Canvas.Layout;

/// <summary>One parsed User Story inside a specs card; Intro is set only on a leading non-story paragraph.</summary>
public sealed record SpecStory(string? Intro, string? Title, string? Priority, string? Why, IReadOnlyList<string> Criteria);

public static class SpecStories
{
    private static readonly Regex TitleRe = new(@"^US\s*\d+\s*·");
    private static readonly Regex PriorityRe = new(@"\(([^)]+)\)\s*$");
    private static readonly Regex NumberedRe = new(@"^\d+[.)]");
    private static readonly Regex NumberPrefixRe = new(@"^\d+[.)]\s*");

    public static IReadOnlyList<SpecStory> Parse(string description)
    {
        var groups = Regex.Split(description, @"\n\s*\n").Select(g => EpicsLayout.LinesOf(g)).Where(g => g.Count > 0).ToList();
        var stories = new List<SpecStory>();
        var cursor = 0;
        if (groups.Count > 0 && groups[0].Count == 1 && !TitleRe.IsMatch(groups[0][0]))
        {
            stories.Add(new SpecStory(groups[0][0], null, null, null, Array.Empty<string>()));
            cursor = 1;
        }
        for (var i = cursor; i < groups.Count; i++)
        {
            var g = groups[i];
            if (!TitleRe.IsMatch(g[0])) continue;
            var title = g[0];
            string? priority = null;
            var m = PriorityRe.Match(g[0]);
            if (m.Success)
            {
                priority = m.Groups[1].Value;
                title = g[0][..m.Index].Trim();
            }
            var k = 1;
            string? why = null;
            if (k < g.Count && !NumberedRe.IsMatch(g[k])) why = g[k++];
            var criteria = new List<string>();
            for (; k < g.Count; k++) criteria.Add(NumberPrefixRe.Replace(g[k], ""));
            stories.Add(new SpecStory(null, title, priority, why, criteria));
        }
        return stories;
    }
}
