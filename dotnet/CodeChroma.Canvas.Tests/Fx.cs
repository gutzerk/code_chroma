namespace CodeChroma.Canvas.Tests;

/// <summary>Loads the shared canvas-logic JSON fixtures (tests/fixtures/canvas_logic) as named xUnit rows.</summary>
internal static class Fx
{
    public static JsonElement Load(string file)
    {
        var path = Path.Combine(AppContext.BaseDirectory, "fixtures", file);
        using var doc = JsonDocument.Parse(File.ReadAllText(path));
        return doc.RootElement.Clone();
    }

    public static IEnumerable<object[]> Cases(string file, string section)
    {
        var index = 0;
        foreach (var item in Load(file).GetProperty(section).EnumerateArray())
        {
            var name = item.TryGetProperty("name", out var n) ? n.GetString()! : $"case {index}";
            index++;
            yield return new object[] { name, item.GetRawText() };
        }
    }

    public static JsonElement Parse(string json) => JsonDocument.Parse(json).RootElement.Clone();

    public static double[] Nums(JsonElement e) => e.EnumerateArray().Select(x => x.GetDouble()).ToArray();

    public static Rect R(JsonElement e)
    {
        var a = Nums(e);
        return new Rect(a[0], a[1], a[2], a[3]);
    }

    public static Point P(JsonElement e)
    {
        var a = Nums(e);
        return new Point(a[0], a[1]);
    }

    public static Box B(JsonElement e)
    {
        var a = Nums(e);
        return new Box(a[0], a[1], a[2], a[3]);
    }

    public static Side S(string name) => Enum.Parse<Side>(name, ignoreCase: true);

    public static void AssertPoint(Point expected, Point actual, int precision = 6)
    {
        Assert.Equal(expected.X, actual.X, precision);
        Assert.Equal(expected.Y, actual.Y, precision);
    }

    /// <summary>Every corner an SVG path visits, so a route's shape is asserted without matching a whole d string.</summary>
    public static List<Point> Corners(string d) =>
        System.Text.RegularExpressions.Regex.Matches(d, @"[MQL] (-?[\d.]+) (-?[\d.]+)")
            .Select(m => new Point(
                double.Parse(m.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture),
                double.Parse(m.Groups[2].Value, System.Globalization.CultureInfo.InvariantCulture)))
            .ToList();

    public static CanvasElement Element(string id, string layer = "c1", RenderKind render = RenderKind.C1,
        double x = 0, double y = 0, string label = "", string description = "", double[]? size = null,
        string? groupId = null, IDictionary<string, object?>? meta = null) =>
        new()
        {
            Id = id, Render = render, Layer = layer, Label = label == "" ? id : label, Description = description,
            Position = new Position(x, y), Size = size is null ? null : new Size(size[0], size[1]),
            GroupId = groupId, Meta = MetaOf(meta),
        };

    public static Dictionary<string, JsonElement> MetaOf(IDictionary<string, object?>? meta) =>
        (meta ?? new Dictionary<string, object?>()).ToDictionary(
            kv => kv.Key, kv => JsonSerializer.SerializeToElement(kv.Value));

    public static Dictionary<string, JsonElement> MetaOf(JsonElement obj) =>
        obj.EnumerateObject().ToDictionary(p => p.Name, p => p.Value.Clone());

    public static CanvasDoc DocOf(params CanvasElement[] elements) =>
        CanvasDoc.Empty with { Elements = elements.ToDictionary(e => e.Id) };

    public static RenderKind Kind(string render) => ElementRules.ParseKind(render);
}
