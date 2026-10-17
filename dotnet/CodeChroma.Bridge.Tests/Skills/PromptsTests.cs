using CodeChroma.Bridge.Skills;

namespace CodeChroma.Bridge.Tests.Skills;

public class PromptsTests
{
    private static string YamlBody(string name, string key = "prompt")
    {
        var dir = Path.Combine(Contract.ContractCases.FixtureDir, "..", "..", "..", "src", "codechroma", "prompts");
        var lines = File.ReadAllLines(Path.Combine(dir, name + ".yaml")).SkipWhile(l => !l.StartsWith(key + ":")).Skip(1)
            .TakeWhile(l => l.Length == 0 || l.StartsWith("  "));
        return string.Join("\n", lines.Select(l => l.Length >= 2 ? l[2..] : l)).TrimEnd('\n');
    }

    [Theory]
    [InlineData("c1_agent")]
    [InlineData("impact_review_agent")]
    [InlineData("patterns_agent")]
    [InlineData("sequence_agent")]
    public void A_static_prompt_is_returned_verbatim_from_the_shipped_yaml(string name) =>
        Assert.Equal(YamlBody(name), Prompts.Render(name));

    [Fact]
    public void Variables_are_substituted_and_the_template_is_formatted()
    {
        var text = Prompts.Render("epic_brief_agent", ("epic_id", "EP-4"), ("job_key", "main:EP-4"), ("bundle", "{\"x\":1}"));

        Assert.Contains("named \"EP-4\"", text);
        Assert.Contains("main:EP-4", text);
        Assert.EndsWith("{\"x\":1}", text);
    }

    [Fact]
    public void Doubled_braces_collapse_when_variables_are_given_and_stay_otherwise()
    {
        Assert.Equal("{a} B", Prompts.Format("{{a}} {b}", [("b", "B")]));
        Assert.Equal("{{a}} {b}", Prompts.Format("{{a}} {b}", []));
    }

    [Fact]
    public void An_unknown_prompt_is_an_error() => Assert.Throws<KeyNotFoundException>(() => Prompts.Render("no_such_prompt"));
}
