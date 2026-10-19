namespace CodeChroma.Canvas.Tests.Layout;

public class EpicsLayoutTests
{
    private const string File = "epics_layout.json";

    public static IEnumerable<object[]> LayoutCases => Fx.Cases(File, "layouts");
    public static IEnumerable<object[]> LayerNameCases => Fx.Load(File).GetProperty("layerNames").EnumerateArray()
        .Select(c => new object[] { c.GetProperty("layer").GetString()!, c.GetProperty("isEpics").GetBoolean() });
    public static IEnumerable<object[]> WidthCases => Fx.Cases(File, "fitWidth");
    public static IEnumerable<object[]> HeightCases => Fx.Cases(File, "fitHeight");
    public static IEnumerable<object[]> StoryCases => Fx.Cases(File, "storyGroups");

    private static string Text(JsonElement c)
    {
        if (c.TryGetProperty("descriptionRepeat", out var rep)) return string.Concat(Enumerable.Repeat(rep[0].GetString()!, rep[1].GetInt32()));
        var text = c.GetProperty("description").GetString()!;
        if (c.TryGetProperty("lineRepeat", out var line)) text += string.Concat(Enumerable.Repeat(line[0].GetString()!, line[1].GetInt32()));
        return text;
    }

    private static CanvasElement Epic(string description, IDictionary<string, object?>? meta = null) =>
        Fx.Element("e", layer: "epics", render: RenderKind.Epic, description: description, meta: meta);

    private static CanvasDoc DocFor(JsonElement boxes)
    {
        var elements = boxes.EnumerateArray().Select(b => Fx.Element(
            b.GetProperty("id").GetString()!, layer: "epics", render: Fx.Kind(b.GetProperty("render").GetString()!),
            label: b.GetProperty("key").GetString()!,
            size: b.TryGetProperty("size", out var s) ? Fx.Nums(s) : null,
            meta: new Dictionary<string, object?> { ["recipe_key"] = b.GetProperty("key").GetString() })).ToArray();
        return Fx.DocOf(elements);
    }

    [Theory, MemberData(nameof(LayoutCases))]
    public void Columns_phases_and_tasks_are_placed_deterministically(string name, string json)
    {
        var c = Fx.Parse(json);
        var doc = DocFor(c.GetProperty("boxes"));

        var pos = EpicsLayout.Layout(doc, doc.Elements.Keys.ToList()).Positions;

        foreach (var check in c.GetProperty("checks").EnumerateArray())
        {
            var args = check.EnumerateArray().Select(x => x.ValueKind == JsonValueKind.String ? x.GetString()! : x.GetRawText()).ToArray();
            var ok = args[0] switch
            {
                "distinctPositions" => pos.Values.Select(p => (p.X, p.Y)).Distinct().Count() == pos.Count,
                "sameX" => pos[args[1]].X == pos[args[2]].X,
                "sameY" => pos[args[1]].Y == pos[args[2]].Y,
                "ltX" => pos[args[1]].X < pos[args[2]].X,
                "gtY" => pos[args[1]].Y > pos[args[2]].Y,
                "ltY" => pos[args[1]].Y < pos[args[2]].Y,
                "xBeyond" => pos[args[1]].X > pos[args[2]].X + double.Parse(args[3], System.Globalization.CultureInfo.InvariantCulture),
                "distinctX" => args.Skip(1).Select(id => pos[id].X).Distinct().Count() == args.Length - 1,
                _ => throw new InvalidOperationException($"unknown check {args[0]}"),
            };
            Assert.True(ok, $"{name}: check {string.Join(' ', args)} failed");
        }
    }

    [Theory, MemberData(nameof(LayerNameCases))]
    public void Epics_layer_names_are_the_builtin_and_the_per_epic_prefix(string layer, bool isEpics)
    {
        Assert.Equal(isEpics, EpicsLayout.IsEpicsLayerName(layer));
    }

    [Fact]
    public void IsEpicsLayer_needs_an_epic_or_group_box_on_an_epics_layer()
    {
        var doc = Fx.DocOf(
            Fx.Element("epic-1", layer: "epics", render: RenderKind.Epic),
            Fx.Element("e-2", layer: "epics/EP-2", render: RenderKind.Epic),
            Fx.Element("note", layer: "epics", render: RenderKind.Note));

        Assert.True(EpicsLayout.IsEpicsLayer(doc, new[] { "epic-1" }));
        Assert.True(EpicsLayout.IsEpicsLayer(doc, new[] { "e-2" }));
        Assert.False(EpicsLayout.IsEpicsLayer(doc, new[] { "note" }));
        Assert.False(EpicsLayout.IsEpicsLayer(doc, new[] { "not-an-epic" }));
    }

    [Fact]
    public void A_group_frame_is_recorded_at_its_centre_so_it_wraps_its_members()
    {
        var doc = Fx.DocOf(
            Fx.Element("frame", layer: "epics", render: RenderKind.Group, meta: new Dictionary<string, object?> { ["recipe_key"] = "__group__::EP-4" }),
            Fx.Element("epic", layer: "epics", render: RenderKind.Epic, groupId: "frame", size: new double[] { 760, 72 }, meta: new Dictionary<string, object?> { ["recipe_key"] = "EP-4" }),
            Fx.Element("spec", layer: "epics", render: RenderKind.Spec, groupId: "frame", size: new double[] { 300, 84 }, meta: new Dictionary<string, object?> { ["recipe_key"] = "EP-4::foundation" }));

        var pos = EpicsLayout.Layout(doc, doc.Elements.Keys.ToList()).Positions;

        Assert.Equal(pos["epic"].X + 760 / 2.0, pos["frame"].X);
        Assert.True(pos["frame"].Y > pos["epic"].Y);
        Assert.True(pos["frame"].Y < pos["spec"].Y + 42);
    }

    [Theory, MemberData(nameof(WidthCases))]
    public void FitContentWidth_sizes_lists_prose_and_titles(string name, string json)
    {
        var c = Fx.Parse(json);

        var width = EpicsLayout.FitContentWidth(Epic(Text(c)));

        Assert.Equal(c.GetProperty("expected").GetDouble(), width, 6);
    }

    [Theory, MemberData(nameof(HeightCases))]
    public void FitContentHeight_budgets_rows_chrome_and_story_padding(string name, string json)
    {
        var c = Fx.Parse(json);
        var meta = c.GetProperty("specs").GetBoolean() ? new Dictionary<string, object?> { ["specs"] = "1" } : null;

        var height = EpicsLayout.FitContentHeight(Epic(Text(c), meta), c.GetProperty("width").GetDouble());

        Assert.Equal(c.GetProperty("expected").GetDouble(), height, 6);
    }

    [Fact]
    public void A_wider_list_is_strictly_wider_than_a_shorter_one_above_the_floor()
    {
        var wide = EpicsLayout.FitContentWidth(Epic("Settings exposes background, block-style and arrow-color pickers.\nStyle engine resolves the chosen settings into theme variables the canvas consumes."));
        var narrow = EpicsLayout.FitContentWidth(Epic("Short.\nAlso short."));

        Assert.True(wide > narrow);
    }

    [Theory, MemberData(nameof(StoryCases))]
    public void The_height_estimate_never_under_counts_a_group_the_renderer_draws_as_a_story_card(string name, string json)
    {
        var description = Fx.Parse(json).GetProperty("description").GetString()!;
        var rendered = SpecStories.Parse(description).Count(s => s.Title is not null);

        var groups = EpicsLayout.StoryGroupCount(description);
        var height = EpicsLayout.FitContentHeight(Epic(description, new Dictionary<string, object?> { ["specs"] = "1" }), 800);

        Assert.True(groups >= rendered);
        Assert.True(height >= 88 + rendered * (21 + 18));
    }

    [Fact]
    public void A_measured_height_replaces_the_estimate_and_pushes_the_card_bottom_lower()
    {
        var doc = Fx.DocOf(
            Fx.Element("epic", layer: "epics", render: RenderKind.Epic, meta: new Dictionary<string, object?> { ["recipe_key"] = "EP-4" }),
            Fx.Element("specs", layer: "epics", render: RenderKind.Spec, meta: new Dictionary<string, object?> { ["recipe_key"] = "EP-4::specs", ["specs"] = "1" }));
        var ids = doc.Elements.Keys.ToList();

        var estimated = EpicsLayout.Layout(doc, ids);
        var measured = EpicsLayout.Layout(doc, ids, new Dictionary<string, double> { ["specs"] = 580 });

        Assert.Equal(580, measured.Sizes["specs"].H);
        Assert.True(measured.Sizes["specs"].H > estimated.Sizes["specs"].H);
        Assert.True(measured.Positions["specs"].Y > estimated.Positions["specs"].Y);
    }

    [Theory]
    [InlineData("US1 · Add widget (P1 · MVP)\nWhy it matters.\n1. First.\n2) Second.", "US1 · Add widget", "P1 · MVP", "Why it matters.", 2)]
    [InlineData("US2 · No why (P2)\n1. Only criteria.", "US2 · No why", "P2", null, 1)]
    public void Spec_stories_split_title_priority_why_and_numbered_criteria(string text, string title, string priority, string? why, int criteria)
    {
        var story = SpecStories.Parse(text).Single();

        Assert.Equal(title, story.Title);
        Assert.Equal(priority, story.Priority);
        Assert.Equal(why, story.Why);
        Assert.Equal(criteria, story.Criteria.Count);
    }

    [Fact]
    public void A_leading_single_line_that_is_not_a_story_title_is_the_intro_and_stray_paragraphs_are_dropped()
    {
        var stories = SpecStories.Parse("An intro.\n\nUS1 · One (P1)\nA.\n\nstray\n\nUS2 · Two (P2)\nB.");

        Assert.Equal("An intro.", stories[0].Intro);
        Assert.Equal(new[] { "US1 · One", "US2 · Two" }, stories.Skip(1).Select(s => s.Title!).ToArray());
    }
}
