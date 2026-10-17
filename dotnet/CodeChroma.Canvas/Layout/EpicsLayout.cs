using System.Text.RegularExpressions;

namespace CodeChroma.Canvas.Layout;

public sealed record EpicsLayoutResult(IReadOnlyDictionary<string, Position> Positions, IReadOnlyDictionary<string, Size> Sizes, Size Size);

/// <summary>
/// Deterministic per-epic column layout (port of epicsLayout.ts): one column per root, an epic's content cards stacked
/// under it, phase specs in a horizontal row with their tasks hanging below. Epic, spec and task positions are
/// BOTTOM-LEFT corners; group frames are recorded at their centre.
/// </summary>
public static class EpicsLayout
{
    private const double BoxWidth = 300, EpicHeight = 72, SpecHeight = 84, TaskHeight = 60;
    private const double ColumnGap = 140, CardGap = 24, TaskGap = 80, FramePad = 8;
    private const double CharWidth = 0.62 * 14;
    private const double ContentHPadding = 48, ContentMinWidth = 640, ContentMaxWidth = 1480, ProseWidth = 860;
    private const double LineHeight = 21, BoxHChrome = 88, ContentHTextWidth = 32, StoryPad = 18;

    private sealed class Placed
    {
        public string Id = "", Key = "";
        public RenderKind Render;
        public double X, Y, Width, Height;
        public List<Placed> Children = new();
    }

    public static bool IsEpicsLayerName(string layer) => layer == "epics" || layer.StartsWith("epics/", StringComparison.Ordinal);

    public static bool IsEpicsLayer(CanvasDoc doc, IReadOnlyList<string> ids) =>
        ids.Any(id => doc.Elements.TryGetValue(id, out var e) && IsEpicsLayerName(e.Layer) && e.Render is RenderKind.Epic or RenderKind.Group);

    public static IReadOnlyList<string> LinesOf(string text) =>
        text.Split('\n').Select(s => s.Trim()).Where(s => s.Length > 0).ToList();

    /// <summary>Blank-line-separated story groups, the count both the renderer and the height estimate share.</summary>
    public static int StoryGroupCount(string text) =>
        Regex.Split(text, @"\n\s*\n").Select(g => g.Trim()).Count(g => g.Length > 0);

    public static bool IsSummary(CanvasElement e) => ElementMeta.String(e, "summary") is not null;
    public static bool IsAcceptance(CanvasElement e) => ElementMeta.String(e, "acceptance") is not null;
    public static bool IsSpecs(CanvasElement e) => ElementMeta.String(e, "specs") is not null;
    public static bool IsContentCard(CanvasElement e) => IsSummary(e) || IsAcceptance(e) || IsSpecs(e);

    public static bool IsPhaseSpec(RenderKind render, string key) => render == RenderKind.Spec && Regex.IsMatch(key, @"phase-\d+");

    /// <summary>The parent key a box hangs under: the segment before the last "::".</summary>
    public static string? ParentKeyOf(string recipeKey)
    {
        var idx = recipeKey.LastIndexOf("::", StringComparison.Ordinal);
        return idx > 0 ? recipeKey[..idx] : null;
    }

    public static double FitContentWidth(CanvasElement element)
    {
        var lines = LinesOf(element.Description);
        if (lines.Count > 1)
        {
            var widest = lines.Max(s => s.Length);
            return Math.Min(ContentMaxWidth, Math.Max(ContentMinWidth, widest * CharWidth + ContentHPadding));
        }
        if (element.Description.Length > 0) return Math.Min(ContentMaxWidth, ProseWidth);
        return ContentMinWidth;
    }

    public static double FitContentHeight(CanvasElement element, double width)
    {
        if (IsSpecs(element))
            return BoxHChrome + LinesOf(element.Description).Count * LineHeight + StoryGroupCount(element.Description) * StoryPad;
        var lines = LinesOf(element.Description);
        if (lines.Count > 1) return BoxHChrome + lines.Count * LineHeight;
        if (element.Description.Length > 0)
        {
            var innerWidth = Math.Max(100, width - ContentHTextWidth);
            var charsPerLine = Math.Max(1, Math.Floor(innerWidth / CharWidth));
            var count = Math.Max(1, Math.Ceiling(element.Description.Length / charsPerLine));
            return BoxHChrome + count * LineHeight;
        }
        return HeightFor(element.Render);
    }

    private static double HeightFor(RenderKind render) => render switch
    {
        RenderKind.Spec => SpecHeight,
        RenderKind.Task => TaskHeight,
        _ => EpicHeight,
    };

    private static int PhaseNumber(CanvasElement element)
    {
        var m = Regex.Match(ElementMeta.String(element, "recipe_key") ?? "", @"phase-(\d+)");
        return m.Success ? int.Parse(m.Groups[1].Value) : 0;
    }

    private static double PlaceSubtree(Placed node, double x, double startY)
    {
        node.X = x;
        node.Y = startY + node.Height;
        var cursorY = startY + node.Height;
        foreach (var child in node.Children)
        {
            cursorY += TaskGap;
            cursorY = PlaceSubtree(child, x, cursorY);
        }
        return cursorY;
    }

    private static double SubtreeMaxWidth(Placed node, Dictionary<Placed, double> cache)
    {
        if (cache.TryGetValue(node, out var hit)) return hit;
        var own = node.Children.Aggregate(node.Width, (acc, c) => Math.Max(acc, SubtreeMaxWidth(c, cache)));
        cache[node] = own;
        return own;
    }

    private static double SubtreeBottom(Placed node) =>
        node.Children.Count > 0 ? Math.Max(node.Y, node.Children.Max(SubtreeBottom)) : node.Y;

    public static EpicsLayoutResult Layout(CanvasDoc doc, IReadOnlyList<string> epicIds, IReadOnlyDictionary<string, double>? measuredHeights = null)
    {
        var elements = epicIds.Where(doc.Elements.ContainsKey).Select(id => doc.Elements[id]).ToList();
        var boxes = new List<Placed>();
        var frames = new List<Placed>();
        foreach (var element in elements)
        {
            if (element.Render == RenderKind.Group)
            {
                frames.Add(new Placed { Id = element.Id, Key = ElementMeta.String(element, "recipe_key") ?? element.Id, Render = RenderKind.Group });
                continue;
            }
            var card = IsContentCard(element);
            var width = card ? FitContentWidth(element) : element.Size?.W ?? BoxWidth;
            double? measured = measuredHeights is not null && measuredHeights.TryGetValue(element.Id, out var mh) ? mh : null;
            var height = measured ?? (card
                ? element.Size?.H ?? FitContentHeight(element, width)
                : element.Size?.H ?? HeightFor(element.Render));
            boxes.Add(new Placed
            {
                Id = element.Id, Key = ElementMeta.String(element, "recipe_key") ?? element.Id,
                Render = element.Render, Width = width, Height = height,
            });
        }

        var byId = elements.ToDictionary(e => e.Id);
        var byKey = new Dictionary<string, Placed>();
        foreach (var box in boxes) byKey[box.Key] = box;
        var roots = new List<Placed>();
        foreach (var box in boxes)
        {
            var parentKey = ParentKeyOf(box.Key);
            if (parentKey is not null && byKey.TryGetValue(parentKey, out var parent)) parent.Children.Add(box);
            else roots.Add(box);
        }
        foreach (var box in boxes)
        {
            box.Children = box.Children
                .OrderByDescending(c => IsContentCard(byId[c.Id]))
                .ThenBy(c => PhaseNumber(byId[c.Id]))
                .ThenBy(c => ElementMeta.String(byId[c.Id], "recipe_key") ?? c.Id, StringComparer.Ordinal)
                .ToList();
        }

        var widthCache = new Dictionary<Placed, double>();
        double cursorX = 0;
        foreach (var root in roots)
        {
            root.X = cursorX;
            root.Y = root.Height;
            var cursorY = root.Height;
            var phases = root.Children.Where(c => IsPhaseSpec(c.Render, c.Key)).ToList();
            var stacked = root.Children.Where(c => !IsPhaseSpec(c.Render, c.Key)).ToList();
            foreach (var child in stacked)
            {
                cursorY += CardGap;
                cursorY = PlaceSubtree(child, cursorX, cursorY);
            }
            var phasesTop = cursorY + CardGap;
            var phaseX = cursorX;
            foreach (var phase in phases)
            {
                phase.X = phaseX;
                phase.Y = phasesTop + phase.Height;
                var py = phasesTop + phase.Height;
                foreach (var task in phase.Children)
                {
                    py += TaskGap;
                    py = PlaceSubtree(task, phaseX, py);
                }
                var phaseWidth = Math.Max(SubtreeMaxWidth(phase, widthCache), BoxWidth);
                phaseX += phaseWidth + ColumnGap;
                cursorY = Math.Max(cursorY, py);
            }
            var phasesSpan = phases.Count > 0 ? phaseX - ColumnGap - cursorX : 0;
            var columnWidth = Math.Max(Math.Max(SubtreeMaxWidth(root, widthCache), phasesSpan), BoxWidth);
            cursorX += columnWidth + ColumnGap;
        }

        var members = new Dictionary<string, List<Placed>>();
        foreach (var box in boxes)
        {
            var gid = byId[box.Id].GroupId;
            if (gid is null) continue;
            if (!members.TryGetValue(gid, out var list)) members[gid] = list = new List<Placed>();
            list.Add(box);
        }
        foreach (var frame in frames)
        {
            var list = members.TryGetValue(frame.Id, out var m) ? new List<Placed>(m) : new List<Placed>();
            var ownerKey = frame.Key.StartsWith("__group__::", StringComparison.Ordinal) ? frame.Key["__group__::".Length..] : frame.Key;
            var owner = ownerKey.Length > 0 ? boxes.FirstOrDefault(b => b.Key == ownerKey) : null;
            if (owner is not null && list.All(x => x.Id != owner.Id)) list.Add(owner);
            if (list.Count == 0) continue;
            var minX = list.Min(x => x.X);
            var minY = list.Min(x => x.Y - x.Height);
            var maxX = list.Max(x => x.X + x.Width);
            var maxY = list.Max(SubtreeBottom);
            frame.X = minX - FramePad;
            frame.Y = minY - FramePad;
            frame.Width = maxX - minX + FramePad * 2;
            frame.Height = maxY - minY + FramePad * 2;
        }

        var positions = new Dictionary<string, Position>();
        foreach (var placed in boxes.Concat(frames))
            positions[placed.Id] = placed.Render == RenderKind.Group
                ? new Position(placed.X + placed.Width / 2, placed.Y + placed.Height / 2)
                : new Position(placed.X, placed.Y);
        var totalWidth = cursorX == 0 ? 0 : cursorX - ColumnGap;
        var maxHeight = Math.Max(0, Math.Max(
            boxes.Count > 0 ? boxes.Max(SubtreeBottom) : 0,
            frames.Count > 0 ? frames.Max(f => f.Y + f.Height) : 0));
        var sizes = boxes.ToDictionary(b => b.Id, b => new Size(b.Width, b.Height));
        return new EpicsLayoutResult(positions, sizes, new Size(totalWidth, maxHeight));
    }
}
