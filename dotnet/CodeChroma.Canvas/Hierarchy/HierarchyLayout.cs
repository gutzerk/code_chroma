namespace CodeChroma.Canvas.Hierarchy;

/// <summary>One laid-out block; <see cref="Rect"/> is in absolute canvas coordinates (top-left anchored), parents contain children.</summary>
public sealed record HierarchyBox(string Id, HierarchyItem Item, int Depth, string? ParentBoxId, Rect Rect, double HeaderHeight, bool Expanded, bool CodeOpen);

public sealed class HierarchyScene
{
    private readonly Dictionary<string, HierarchyBox> _byId;

    public HierarchyScene(IReadOnlyList<HierarchyBox> boxes)
    {
        Boxes = boxes;
        _byId = boxes.ToDictionary(b => b.Id);
    }

    /// <summary>Pre-order: a parent always precedes its children, so later means deeper or on top.</summary>
    public IReadOnlyList<HierarchyBox> Boxes { get; }

    public HierarchyBox? Find(string id) => _byId.GetValueOrDefault(id);

    public IEnumerable<HierarchyBox> TopLevel => Boxes.Where(b => b.Depth == 0);

    public IReadOnlyList<HierarchyBox> ChildrenOf(string id) => Boxes.Where(b => b.ParentBoxId == id).ToList();

    /// <summary>The deepest box under a canvas point.</summary>
    public HierarchyBox? HitTest(Point p) =>
        Boxes.LastOrDefault(b => p.X >= b.Rect.Left && p.X <= b.Rect.Right && p.Y >= b.Rect.Top && p.Y <= b.Rect.Bottom);

    public IReadOnlyList<HierarchyBox> Query(Rect r) => Boxes.Where(b => b.Rect.Intersects(r)).ToList();
}

/// <summary>
/// Nested expand-in-place layout (the geometry of Block.tsx and layoutConfig.ts): collapsed blocks are a minimum card, an
/// open block shows its description and a grid of its children (one row of up to five, else one column), and the top-level
/// Systems sit on a wrapped grid unless the user dragged them.
/// </summary>
public static class HierarchyLayout
{
    public const double MinWidth = 240, MinHeight = 64, ChildGap = 12, Padding = 12, HeaderTop = 10, NameLine = 20, ParamsLine = 16, CodePanelHeight = 200, CodePanelWidth = 480;
    public const int MaxRowColumns = 5;
    public const double TopNodeSep = 110, TopRankSep = 160;
    private const double DescFont = 12, DescLineClamp = 4;

    public static HierarchyScene Compute(IHierarchySource source, ExpansionState expansion, ITextMeasurer? measurer = null, IReadOnlyDictionary<string, Position>? topPositions = null)
    {
        var tops = source.Children(HierarchyIds.Root);
        var measured = tops.Select(t => Measure(source, expansion, measurer, t)).ToList();
        var columns = Math.Max(1, (int)Math.Ceiling(Math.Sqrt(tops.Count)));
        var boxes = new List<HierarchyBox>();
        double x = 0, y = 0, rowHeight = 0;
        var column = 0;
        for (var i = 0; i < measured.Count; i++)
        {
            var m = measured[i];
            var at = topPositions is not null && topPositions.TryGetValue(m.Item.Id, out var saved) ? new Point(saved.X, saved.Y) : new Point(x, y);
            Place(m, at.X, at.Y, 0, null, boxes);
            rowHeight = Math.Max(rowHeight, m.Height);
            x += m.Width + TopNodeSep;
            if (++column >= columns) { column = 0; x = 0; y += rowHeight + TopRankSep; rowHeight = 0; }
        }
        return new HierarchyScene(boxes);
    }

    private sealed record Measured(HierarchyItem Item, double Width, double Height, double Header, bool Expanded, bool CodeOpen, IReadOnlyList<Measured> Children, IReadOnlyList<double> ColumnX, IReadOnlyList<double> RowY, int Columns);

    private static Measured Measure(IHierarchySource source, ExpansionState expansion, ITextMeasurer? measurer, HierarchyItem item)
    {
        var expanded = expansion.IsExpanded(item.Id);
        var codeOpen = expansion.IsCodeVisible(item.Id);
        var header = HeaderTop + NameLine + (item.Params is null ? 0 : ParamsLine);
        if (expanded && !string.IsNullOrEmpty(item.Description))
            header += 4 + DescriptionHeight(measurer, item.Description!, MinWidth);
        header += HeaderTop;
        header = Math.Max(MinHeight, header);

        if (codeOpen)
            return new Measured(item, CodePanelWidth, header + CodePanelHeight, header, expanded, true, [], [], [], 1);
        if (!expanded || !item.HasChildren)
            return new Measured(item, MinWidth, header, header, expanded, false, [], [], [], 1);

        var kids = source.Children(item.Id).Select(c => Measure(source, expansion, measurer, c)).ToList();
        if (kids.Count == 0) return new Measured(item, MinWidth, header, header, expanded, false, [], [], [], 1);
        var columns = kids.Count > MaxRowColumns ? 1 : kids.Count;
        var rows = (kids.Count + columns - 1) / columns;
        var colWidths = new double[columns];
        var rowHeights = new double[rows];
        for (var i = 0; i < kids.Count; i++)
        {
            colWidths[i % columns] = Math.Max(colWidths[i % columns], kids[i].Width);
            rowHeights[i / columns] = Math.Max(rowHeights[i / columns], kids[i].Height);
        }
        var colX = new double[columns];
        var rowY = new double[rows];
        double cx = Padding;
        for (var c = 0; c < columns; c++) { colX[c] = cx; cx += colWidths[c] + ChildGap; }
        double ry = header + ChildGap;
        for (var r = 0; r < rows; r++) { rowY[r] = ry; ry += rowHeights[r] + ChildGap; }
        var width = Math.Max(MinWidth, cx - ChildGap + Padding);
        var height = ry - ChildGap + Padding;
        return new Measured(item, width, height, header, true, false, kids, colX, rowY, columns);
    }

    private static void Place(Measured m, double x, double y, int depth, string? parent, List<HierarchyBox> into)
    {
        into.Add(new HierarchyBox(m.Item.Id, m.Item, depth, parent, new Rect(x, y, m.Width, m.Height), m.Header, m.Expanded, m.CodeOpen));
        for (var i = 0; i < m.Children.Count; i++)
            Place(m.Children[i], x + m.ColumnX[i % m.Columns], y + m.RowY[i / m.Columns], depth + 1, m.Item.Id, into);
    }

    private static double DescriptionHeight(ITextMeasurer? measurer, string text, double width)
    {
        if (measurer is null) return 16;
        var size = measurer.Measure(text, width - 2 * Padding, DescFont);
        return Math.Min(size.Height, measurer.LineHeight * DescLineClamp);
    }
}
