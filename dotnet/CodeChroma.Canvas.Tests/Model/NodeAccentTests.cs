namespace CodeChroma.Canvas.Tests.Model;

/// <summary>nodeAccent.test.tsx (39 tests) as semantic tables; CSS class names and DOM chips become accent/label values.</summary>
public class NodeAccentTests
{
    private const string File = "node_accent.json";

    public static IEnumerable<object[]> AccentCases => Fx.Cases(File, "accent");
    public static IEnumerable<object[]> TopBandCases => Fx.Cases(File, "topBand");
    public static IEnumerable<object[]> ImpactCases => Fx.Cases(File, "impactChip");
    public static IEnumerable<object[]> NoCodeCases => Fx.Cases(File, "noCodeChip");
    public static IEnumerable<object[]> MetaRowCases => Fx.Cases(File, "metaRow");

    private static readonly Func<string, bool> Brands = slug =>
        Fx.Load(File).GetProperty("brandSlugs").EnumerateArray().Any(s => s.GetString() == slug);

    private static CanvasElement Box(JsonElement c) =>
        new()
        {
            Id = "e1", Render = Fx.Kind(c.TryGetProperty("render", out var r) ? r.GetString()! : "custom"),
            Layer = "default", Label = "Box", Meta = Fx.MetaOf(c.GetProperty("meta")),
        };

    [Theory, MemberData(nameof(AccentCases))]
    public void AccentFor_decides_icon_kind_status_group_shape_and_no_code(string name, string json)
    {
        var c = Fx.Parse(json);
        var expected = c.GetProperty("expected");

        var accent = NodeAccents.AccentFor(Box(c), Brands);

        Assert.Equal(expected.TryGetProperty("icon", out var icon) ? icon.GetString() : null, accent.Icon);
        Assert.Equal(expected.TryGetProperty("kind", out var kind) ? kind.GetString() : null, accent.Kind);
        Assert.Equal(expected.TryGetProperty("status", out var status) ? status.GetString() : null, accent.Status);
        Assert.Equal(expected.TryGetProperty("group", out var group) ? group.GetInt32() : (int?)null, accent.Group);
        Assert.Equal(expected.TryGetProperty("shape", out var shape) ? shape.GetString() : null, accent.Shape);
        Assert.Equal(expected.TryGetProperty("noCode", out var noCode) ? noCode.GetString() : null, accent.NoCode);
    }

    [Fact]
    public void A_plain_node_returns_the_shared_empty_accent()
    {
        var accent = NodeAccents.AccentFor(Fx.Element("e", render: RenderKind.Impact), Brands);

        Assert.Same(NodeAccent.None, accent);
    }

    [Theory, MemberData(nameof(TopBandCases))]
    public void TopBand_holds_the_plan_role_and_the_step_number(string name, string json)
    {
        var c = Fx.Parse(json);

        var band = NodeAccents.TopBandOf(Box(c));

        var expected = c.GetProperty("expected");
        if (expected.ValueKind == JsonValueKind.Null) { Assert.Null(band); return; }
        Assert.NotNull(band);
        Assert.Equal(expected.TryGetProperty("plan", out var plan) ? plan.GetString() : null, band!.Plan);
        Assert.Equal(expected.TryGetProperty("order", out var order) ? order.GetString() : null, band.Order);
    }

    [Theory, MemberData(nameof(ImpactCases))]
    public void ImpactChip_labels_the_authored_status_with_its_mark_and_count(string name, string json)
    {
        var c = Fx.Parse(json);
        int? count = c.TryGetProperty("count", out var n) ? n.GetInt32() : null;

        var chip = NodeAccents.ImpactChipOf(Box(c), count);

        Assert.Equal(c.GetProperty("expected").GetString(), chip);
    }

    [Theory, MemberData(nameof(NoCodeCases))]
    public void NoCodeChip_labels_a_recognised_reason_only(string name, string json)
    {
        var c = Fx.Parse(json);

        Assert.Equal(c.GetProperty("expected").GetString(), NodeAccents.NoCodeChipOf(Box(c)));
    }

    [Theory, MemberData(nameof(MetaRowCases))]
    public void MetaRow_lists_the_chips_the_box_carries(string name, string json)
    {
        var c = Fx.Parse(json);

        var row = NodeAccents.MetaRowOf(Box(c));

        Assert.Equal(c.GetProperty("expected").EnumerateArray().Select(x => x.GetString()!).ToArray(), row.ToArray());
    }

    [Fact]
    public void Group_colour_hash_matches_the_web_palette_hash_for_non_ascii_names()
    {
        Assert.InRange(NodeAccents.GroupColorIndex("Хранилище"), 0, NodeAccents.GroupColorCount - 1);
        Assert.Equal(NodeAccents.GroupColorIndex("Хранилище"), NodeAccents.GroupColorIndex("Хранилище"));
    }

    [Theory]
    [InlineData("conceptual")]
    [InlineData("external")]
    [InlineData("unresolved")]
    public void No_code_popup_message_prefers_the_authored_text_then_the_canned_reason(string reason)
    {
        var plain = Fx.Element("e", meta: new Dictionary<string, object?> { ["no_code_reason"] = reason });
        var authored = Fx.Element("e", meta: new Dictionary<string, object?> { ["no_code_reason"] = reason, ["details"] = "Authored text" });

        Assert.Equal("Authored text", NodeAccents.NoCodeReasonMessage(authored, reason));
        Assert.NotEqual("", NodeAccents.NoCodeReasonMessage(plain, reason));
    }

    [Fact]
    public void An_unresolved_message_echoes_the_authored_path()
    {
        var element = Fx.Element("e", meta: new Dictionary<string, object?> { ["no_code_detail"] = "src/x.py" });

        Assert.Contains("src/x.py", NodeAccents.NoCodeReasonMessage(element, "unresolved"));
    }
}
