namespace CodeChroma.Canvas.Tests.Model;

public class ElementRulesTests
{
    public static IEnumerable<object[]> RuleRows =>
        Fx.Load("element_rules.json").GetProperty("rules").EnumerateArray()
            .Select(r => new object[] { r.GetProperty("kind").GetString()!, r.GetRawText() });

    [Theory, MemberData(nameof(RuleRows))]
    public void Each_kind_lands_in_the_registry_with_its_renderer_and_per_kind_deltas(string kind, string json)
    {
        var expected = Fx.Parse(json);

        var rule = ElementRules.For(ElementRules.ParseKind(kind));

        Assert.Equal(expected.GetProperty("renderer").GetString(), rule.Renderer);
        Assert.Equal(expected.GetProperty("activation").GetString(), rule.Activation);
        Assert.Equal(expected.GetProperty("overlay").GetString(), rule.Overlay);
        Assert.Equal(expected.GetProperty("statusChip").GetString(), rule.StatusChip);
        Assert.Equal(expected.GetProperty("lockedLayout").GetBoolean(), rule.LockedLayout);
    }

    [Fact]
    public void The_registry_covers_every_render_kind_exactly_once()
    {
        var all = Enum.GetValues<RenderKind>();

        Assert.Equal(all.OrderBy(k => k), ElementRules.All.Select(r => r.Kind).OrderBy(k => k));
    }

    [Fact]
    public void Epics_bottom_left_convention_applies_only_to_epic_spec_and_task()
    {
        var bottomLeft = Enum.GetValues<RenderKind>().Where(ElementRules.IsBottomLeft).ToArray();

        Assert.Equal(new[] { RenderKind.Epic, RenderKind.Spec, RenderKind.Task }, bottomLeft);
    }
}
