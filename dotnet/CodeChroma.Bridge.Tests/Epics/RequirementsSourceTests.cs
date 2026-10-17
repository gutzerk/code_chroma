using CodeChroma.Bridge.Epics;
using CodeChroma.Bridge.Tests.Contract;

namespace CodeChroma.Bridge.Tests.Epics;

public sealed class RequirementsSourceTests : IDisposable
{
    private static readonly string Fixture = Path.GetFullPath(Path.Combine(ContractCases.FixtureDir, "..", "requirements_repo"));
    private readonly string _tmp = Path.Combine(Path.GetTempPath(), "cc-epics-" + Guid.NewGuid().ToString("N")[..8]);

    public RequirementsSourceTests() => Directory.CreateDirectory(_tmp);

    public void Dispose()
    {
        try { Directory.Delete(_tmp, recursive: true); } catch (IOException) { }
    }

    private static MarkdownRequirementsSource Fixtures() => new(Path.Combine(Fixture, "plan", "epics"), Fixture);

    private string Write(string relative, string text, string? root = null)
    {
        var path = Path.Combine(root ?? _tmp, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, text);
        return path;
    }

    // -- markdown requirements source --

    [Fact]
    public void Listing_returns_every_item_summary()
    {
        var ids = Fixtures().ListItems().Select(i => i.Id).ToHashSet();

        Assert.Equal(["EP-A-01", "EP-A-01-01", "EP-A-01-02", "EP-A-02", "EP-A-02-01"], ids.Order());
    }

    [Fact]
    public void An_illustrative_block_is_excluded_and_a_trailing_citation_moves_to_source_ref()
    {
        var item = Fixtures().FetchItem("EP-A-01-02")!;

        var requirement = Assert.Single(item.Requirements);
        Assert.Equal("docs/logging.md §2", requirement.SourceRef);
        Assert.DoesNotContain("docs/logging.md", requirement.Text);
    }

    [Fact]
    public void A_criteria_free_item_has_no_requirements() => Assert.Empty(Fixtures().FetchItem("EP-A-02-01")!.Requirements);

    [Fact]
    public void Depends_on_and_enables_become_links()
    {
        var item = Fixtures().FetchItem("EP-A-02")!;

        Assert.Equal([new ItemLink("EP-A-01", "depends_on", "the foundation epic"), new ItemLink("EP-Z-99", "enables", "a future reporting epic")], item.Links);
    }

    [Fact]
    public void An_unknown_id_is_null_and_lookup_ignores_case()
    {
        Assert.Null(Fixtures().FetchItem("NOPE"));
        var item = Fixtures().FetchItem("ep-a-01")!;
        Assert.Equal("EP-A-01", item.Id);
        Assert.Equal("Foundation: shared platform primitives", item.Title);
        Assert.Equal(3, item.Requirements.Count);
        Assert.Equal(2, item.Children.Count);
    }

    [Fact]
    public void A_malformed_body_degrades_to_title_and_status()
    {
        var path = Path.Combine(_tmp, "epics", "broken.md");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, [.. "---\nid: EP-BROKEN\ntitle: Broken item\nstatus: Draft\nkind: epic\n---\n## Acceptance Criteria\n\n- [x] bad: "u8.ToArray(), 0xFF, 0xFE, (byte)'\n']);

        var item = new MarkdownRequirementsSource(Path.Combine(_tmp, "epics"), _tmp).FetchItem("EP-BROKEN")!;

        Assert.Equal(("Broken item", "Draft"), (item.Title, item.Status));
        Assert.Empty(item.Requirements);
    }

    [Fact]
    public void References_context_file_and_component_surface_on_fetch()
    {
        Write("epics/a.md", "---\nid: EP-REF\ntitle: Referencing epic\nstatus: Planned\nkind: epic\nreferences:\n  - plan/epics/LMP-78-infrastructure.md\n  - \"LMP-101\"\ncontext_file: context/work/EP-REF.md\ncomponent: \"application\"\n---\n");

        var item = new MarkdownRequirementsSource(Path.Combine(_tmp, "epics"), _tmp).FetchItem("EP-REF")!;

        Assert.Equal(["plan/epics/LMP-78-infrastructure.md", "LMP-101"], item.References);
        Assert.Equal(("context/work/EP-REF.md", "application"), (item.ContextFile, item.Component));
    }

    [Fact]
    public void A_duplicate_id_keeps_the_first_file()
    {
        Write("epics/a-first.md", "---\nid: EP-DUP\ntitle: First\nstatus: Draft\nkind: epic\n---\n");
        Write("epics/b-second.md", "---\nid: EP-DUP\ntitle: Second\nstatus: Draft\nkind: epic\n---\n");

        var items = new MarkdownRequirementsSource(Path.Combine(_tmp, "epics"), _tmp).ListItems();

        Assert.Equal(["First"], items.Where(i => i.Id == "EP-DUP").Select(i => i.Title));
    }

    [Theory]
    [InlineData("- [x] done one\n- [ ] open one\n", "checklist", 2)]
    [InlineData("Given a\nWhen b\nThen c\n\n**Illustrative** skip me\n\nGiven d\nThen e\n", "given-when-then", 2)]
    [InlineData("- plain one\n1. numbered two\n", "functional", 2)]
    public void The_three_criteria_parsers_are_tried_in_order(string body, string kind, int count)
    {
        var requirements = Frontmatter.ParseCriteria($"## Acceptance Criteria\n\n{body}", "ref.md");

        Assert.Equal(count, requirements.Count);
        Assert.All(requirements, r => Assert.Equal(kind, r.Kind));
    }

    [Theory]
    [InlineData("1. Acceptance Criteria (draft)", "acceptance criteria")]
    [InlineData("Key Deliverables:", "key deliverables")]
    public void Heading_names_are_normalized(string raw, string expected) => Assert.Equal(expected, Frontmatter.NormalizeHeading(raw));

    [Fact]
    public void Malformed_frontmatter_yields_empty_data()
    {
        var (data, body) = Frontmatter.Split("---\nid: [unterminated\n---\nbody");

        Assert.Empty(data);
        Assert.StartsWith("---", body);
    }

    // -- speckit delivery source --

    private static SpeckitDeliverySource Specs() => new(Path.Combine(Fixture, "specs"), Fixture);

    [Fact]
    public void A_feature_attaches_to_the_id_in_its_spec_input_line()
    {
        var kinds = Specs().StagesFor("EP-A-01-01").Select(s => s.Kind).ToHashSet();

        Assert.Equal(["checklist-requirements", "contract-a", "contract-b", "data-model", "plan", "research", "spec", "tasks"], kinds.Order());
    }

    [Fact]
    public void Task_headers_report_counts_and_expanding_parses_phases_and_markers()
    {
        var node = SpeckitDeliverySource.StageNodeId("001-first-story-feature", "tasks");

        var header = Specs().StagesFor("EP-A-01-01").Single(s => s.Kind == "tasks");
        var expanded = Specs().StagesFor("EP-A-01-01", node).Single(s => s.Kind == "tasks");

        Assert.Equal((3, 4), (header.Done, header.Total));
        Assert.Empty(header.Sections);
        Assert.Equal(["Phase 1: Setup", "Phase 2: Core"], expanded.Sections.Select(s => s.Title));
        Assert.Contains("[P]", expanded.Sections[0].Items[1].Text);
        Assert.Equal((1, 2), (expanded.Sections[1].Done, expanded.Sections[1].Total));
    }

    [Fact]
    public void Expanding_data_model_parses_the_table_and_research_the_bold_bullets()
    {
        var dataModel = Specs().StagesFor("EP-A-01-01", SpeckitDeliverySource.StageNodeId("001-first-story-feature", "data-model")).Single(s => s.Kind == "data-model");
        var research = Specs().StagesFor("EP-A-01-01", SpeckitDeliverySource.StageNodeId("001-first-story-feature", "research")).Single(s => s.Kind == "research");

        Assert.Equal(["path", "cache_ttl", "strict"], dataModel.Sections[0].Items.Select(i => i.Id));
        Assert.Contains("—", dataModel.Sections[0].Items[0].Text);
        Assert.Equal(["Caching strategy", "Fallback order"], research.Sections[0].Items.Select(i => i.Id).Order());
        Assert.Equal((null, null), (research.Sections[0].Done, research.Sections[0].Total));
    }

    [Fact]
    public void Lmp_style_ids_and_epic_frontmatter_attach_features()
    {
        Assert.Equal(["plan", "spec"], Specs().StagesFor("LMP-123").Select(s => s.Kind).Order());
        Assert.Equal(["plan", "spec"], Specs().StagesFor("LMP-999").Select(s => s.Kind).Order());
        Assert.Empty(Specs().StagesFor("EP-OTHER-01"));
    }

    [Fact]
    public void A_feature_naming_no_known_id_stays_unattached_and_two_features_both_contribute()
    {
        Write("specs/999-orphan/spec.md", "**Input**: User description: \"no id named here\"\n\nSee also EP-B-02 for background.\n");
        foreach (var slug in new[] { "100-first", "200-second" })
            Write($"specs/{slug}/spec.md", "**Input**: User description: \"for EP-SHARED-01\"\n");
        var source = new SpeckitDeliverySource(Path.Combine(_tmp, "specs"), _tmp);

        Assert.Empty(source.StagesFor("EP-B-02"));
        Assert.Equal(2, source.StagesFor("EP-SHARED-01").Count);
    }

    [Fact]
    public void A_wrapped_checklist_task_and_bold_paragraph_join_their_continuation_lines()
    {
        Write("specs/003/spec.md", "**Input**: User description: \"for EP-D-04-04\"\n");
        Write("specs/003/tasks.md", "## Phase 1\n\n- [ ] T013 [P] [US2] Test: every candidate\n      each with `excluded_reason`, and no error\n");
        Write("specs/003/plan.md", "## Project Structure\n\n**Structure Decision**: single project,\nextending the package.\n\n## Other\n");
        var source = new SpeckitDeliverySource(Path.Combine(_tmp, "specs"), _tmp);

        var task = source.StagesFor("EP-D-04-04", SpeckitDeliverySource.StageNodeId("003", "tasks")).Single(s => s.Kind == "tasks").Sections[0].Items[0];
        var plan = source.StagesFor("EP-D-04-04", SpeckitDeliverySource.StageNodeId("003", "plan")).Single(s => s.Kind == "plan").Sections[0].Items;

        Assert.Equal(("T013", true, "US2"), (task.Id, task.Parallel, task.Story));
        Assert.Equal("T013 [P] [US2] Test: every candidate each with `excluded_reason`, and no error", task.Text);
        Assert.Equal("**Structure Decision**: single project, extending the package.", Assert.Single(plan).Text);
    }

    [Fact]
    public void Deleting_an_artifact_removes_its_stage()
    {
        Write("specs/001-x/spec.md", "**Input**: User description: \"for EP-A-01-01\"\n");
        var tasks = Write("specs/001-x/tasks.md", "- [x] T001 one task\n");
        var source = new SpeckitDeliverySource(Path.Combine(_tmp, "specs"), _tmp);
        Assert.Equal(["spec", "tasks"], source.StagesFor("EP-A-01-01").Select(s => s.Kind).Order());

        File.Delete(tasks);

        Assert.Equal(["spec"], source.StagesFor("EP-A-01-01").Select(s => s.Kind));
    }

    // -- assembler --

    [Fact]
    public void The_index_has_summaries_only_and_the_item_payload_is_full_and_capped()
    {
        var assembler = EpicsAssembler.For(Fixture);

        var index = assembler.Index();
        var item = assembler.Item("EP-A-01-01", SpeckitDeliverySource.StageNodeId("001-first-story-feature", "tasks"))!;
        var capped = new EpicsAssembler(Fixtures(), null, new RequirementsConfig(MaxItems: 2, MaxRequirementsPerItem: 1)).Item("EP-A-01")!;

        Assert.All(index["items"]!.AsArray(), i => Assert.False(i!.AsObject().ContainsKey("requirements")));
        Assert.Equal(5, index["items"]!.AsArray().Count);
        Assert.Equal(1, capped["requirements"]!.AsArray().Count);
        Assert.NotEmpty(item["stages"]!.AsArray().Single(s => s!["kind"]!.GetValue<string>() == "tasks")!["sections"]!.AsArray());
        Assert.Empty(item["stages"]!.AsArray().Single(s => s!["kind"]!.GetValue<string>() == "spec")!["sections"]!.AsArray());
    }

    [Fact]
    public void Links_report_whether_they_are_in_the_index()
    {
        var links = EpicsAssembler.For(Fixture).Item("EP-A-02")!["links"]!.AsArray();

        Assert.Equal([true, false], links.Select(l => l!["in_index"]!.GetValue<bool>()));
    }

    [Fact]
    public void A_missing_source_directory_is_an_empty_index()
    {
        var index = EpicsAssembler.For(_tmp).Index();

        Assert.Empty(index["items"]!.AsArray());
        Assert.Equal(0, index["omitted"]!.GetValue<int>());
    }
}
