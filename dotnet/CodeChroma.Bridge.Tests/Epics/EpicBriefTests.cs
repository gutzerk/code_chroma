using System.Text.Json.Nodes;
using CodeChroma.Bridge.Epics;
using CodeChroma.Bridge.Tests.Contract;

namespace CodeChroma.Bridge.Tests.Epics;

public class EpicBriefTests
{
    private static readonly string Fixture = Path.GetFullPath(Path.Combine(ContractCases.FixtureDir, "..", "requirements_repo"));

    [Fact]
    public void Normalizing_defaults_missing_keys_drops_unknown_ones_and_skips_malformed_entries()
    {
        var raw = JsonNode.Parse("""
            {"epic_id":"E","junk":1,"problem":["a"],"scope":[{"id":"s1","tasks":[{"id":"T1"},"bad",{"id":"T2","parallel":1}]},"x"],
             "acceptance":[{"id":"a1","done":true}],"dependencies":[{"kind":"risk"}]}
            """)!.AsObject();

        var brief = EpicBrief.Normalize(raw);

        Assert.False(brief.ContainsKey("junk"));
        Assert.Equal("", brief["generated_at"]!.GetValue<string>());
        var scope = Assert.Single(brief["scope"]!.AsArray())!;
        Assert.True(scope["in_scope"]!.GetValue<bool>());
        Assert.Equal([false, true], scope["tasks"]!.AsArray().Select(t => t!["parallel"]!.GetValue<bool>()));
        Assert.Equal("", scope["tasks"]![0]!["text"]!.GetValue<string>());
        Assert.Empty(brief["dependencies"]![0]!["ids"]!.AsArray());
        Assert.True(brief["acceptance"]![0]!["done"]!.GetValue<bool>());
    }

    [Fact]
    public void The_bundle_carries_the_epic_its_real_tasks_and_the_write_path()
    {
        var epic = EpicsAssembler.For(Fixture).Item("EP-A-01-01")!;

        var bundle = EpicBrief.BuildBundle(Fixture, "EP-A-01-01", epic, "C:\\x\\b.json");

        Assert.True(bundle["has_spec"]!.GetValue<bool>());
        Assert.Equal("C:/x/b.json", bundle["write_path"]!.GetValue<string>());
        var stage = Assert.Single(bundle["tasks_by_stage"]!.AsArray())!;
        Assert.Equal("001-first-story-feature", stage["name"]!.GetValue<string>());
        Assert.NotEmpty(stage["sections"]!.AsArray());
    }

    [Fact]
    public void Resolving_splices_the_real_task_text_by_stage_and_id()
    {
        var epic = EpicsAssembler.For(Fixture).Item("EP-A-01-01")!;
        var tasks = EpicBrief.BuildBundle(Fixture, "EP-A-01-01", epic, "")["tasks_by_stage"]![0]!["sections"]![0]!["items"]![1]!;
        var id = tasks["id"]!.GetValue<string>();
        var raw = JsonNode.Parse($$"""
            {"scope":[{"id":"s","tasks":[{"id":"{{id}}","stage":"001-first-story-feature","text":"stale","parallel":false},{"id":"{{id}}","stage":"other","text":"keep"}]}],
             "prep_tasks":[{"id":"{{id}}","stage":"001-first-story-feature","text":"stale"}]}
            """)!.AsObject();

        var resolved = EpicBrief.Resolve(raw, Fixture, epic);

        Assert.Equal(tasks["text"]!.GetValue<string>(), resolved["scope"]![0]!["tasks"]![0]!["text"]!.GetValue<string>());
        Assert.Equal("keep", resolved["scope"]![0]!["tasks"]![1]!["text"]!.GetValue<string>());
        Assert.Equal(tasks["text"]!.GetValue<string>(), resolved["prep_tasks"]![0]!["text"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("EP-4", true)]
    [InlineData("ep_4-01", true)]
    [InlineData("../x", false)]
    [InlineData("a/b", false)]
    [InlineData("", false)]
    public void An_epic_id_must_be_one_filesystem_safe_segment(string id, bool valid) => Assert.Equal(valid, CodeChroma.Bridge.Routes.EpicsRoutes.ValidEpicId(id));

    [Fact]
    public void The_job_key_and_artifact_path_follow_the_item_half()
    {
        var key = EpicBrief.JobKey("pr-3", "EP-A-01");

        Assert.Equal("pr-3:EP-A-01", key);
        Assert.EndsWith(Path.Combine("epics", "briefs", "EP-A-01.json"), EpicBrief.BriefPath("/repo", key));
    }
}
