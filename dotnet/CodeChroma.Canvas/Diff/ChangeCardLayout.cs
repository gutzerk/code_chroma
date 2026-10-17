namespace CodeChroma.Canvas.Diff;

/// <summary>A "Changed here" panel pinned beside a block, with the dashed connector from the block to the panel.</summary>
public sealed record ChangeCardPanel(string NodeId, Rect Rect, IReadOnlyList<ChangeCard> Cards, bool AncestorHint, Point From, Point To)
{
    public string Title => $"Changed here · {Cards.Count} {(Cards.Count == 1 ? "change" : "changes")}";
}

/// <summary>
/// Places the change-card panels (CardPanel.tsx's geometry): one panel per visible block, to its right, several cards stacked
/// in it. A card whose own block is hidden by a collapsed ancestor lands on that ancestor with a "changed inside here" hint.
/// </summary>
public static class ChangeCardLayout
{
    public const double PanelWidth = 260, Gap = 28, HeaderHeight = 28, CardHeight = 40;

    public static IReadOnlyList<ChangeCardPanel> Place(IEnumerable<ChangeCard> cards, Func<string, string> nearestVisible, Func<string, Rect?> rectOf)
    {
        var panels = new List<ChangeCardPanel>();
        foreach (var group in cards.GroupBy(c => nearestVisible(c.NodeId)))
        {
            if (rectOf(group.Key) is not { } block) continue;
            var list = group.ToList();
            var rect = new Rect(block.Right + Gap, block.Top, PanelWidth, HeaderHeight + CardHeight * list.Count);
            var (from, to) = TraceFlow.BorderSegment(block, rect);
            panels.Add(new ChangeCardPanel(group.Key, rect, list, list.Any(c => c.NodeId != group.Key), from, to));
        }
        return panels;
    }
}
