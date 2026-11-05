using System.Text.Json.Nodes;
using CodeChroma.Bridge.Agents;

namespace CodeChroma.Bridge.Tests.Agents;

/// <summary>The herdr-style status rule engine, over tests/fixtures/agent_screens shared with tests/unit/test_agent_status.py.</summary>
public class StatusDetectorTests
{
    private static readonly string Screens = FindScreens();

    private static string FindScreens()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidate = Path.Combine(dir.FullName, "tests", "fixtures", "agent_screens");
            if (Directory.Exists(candidate)) return candidate;
        }
        throw new DirectoryNotFoundException("tests/fixtures/agent_screens not found above " + AppContext.BaseDirectory);
    }

    private static string[] Screen(string name) =>
        File.ReadAllText(Path.Combine(Screens, name)).Replace("\r\n", "\n").TrimEnd('\n').Split('\n');

    private static JsonArray Table(string file) => JsonNode.Parse(File.ReadAllText(Path.Combine(Screens, file)))!.AsArray();

    public static TheoryData<int> CaseIndexes() => Indexes("cases.json");

    public static TheoryData<int> RegionIndexes() => Indexes("regions.json");

    private static TheoryData<int> Indexes(string file)
    {
        var data = new TheoryData<int>();
        for (var i = 0; i < Table(file).Count; i++) data.Add(i);
        return data;
    }

    [Theory]
    [MemberData(nameof(CaseIndexes))]
    public void Shared_screens_classify_as_expected(int index)
    {
        var entry = Table("cases.json")[index]!;
        var lines = entry["screen"] is { } file ? Screen((string)file!) : entry["lines"]?.AsArray().Select(l => (string)l!).ToArray() ?? [];
        var detector = new StatusDetector(StatusRules.ForKind((string)entry["kind"]!));

        var state = detector.Classify(lines, (string?)entry["title"] ?? "", (string?)entry["progress"] ?? "", null);

        Assert.Equal((string?)entry["expected"], state);
        Assert.Equal((string?)entry["rule"], detector.LastClassification.RuleId);
        Assert.Equal((bool)entry["visible_blocker"]!, detector.LastVisibleBlocker);
    }

    [Theory]
    [MemberData(nameof(RegionIndexes))]
    public void Shared_regions_slice_the_screen_like_herdr(int index)
    {
        var entry = Table("regions.json")[index]!;
        var screen = new DetectScreen(entry["lines"]!.AsArray().Select(l => (string)l!).ToArray());

        var region = screen.Region((string)entry["region"]!, "the title", "running");

        Assert.Equal((string)entry["expected"]!, region);
    }

    [Theory]
    [InlineData("claude")]
    [InlineData("codex")]
    [InlineData("kimi")]
    [InlineData("gemini")]
    public void Every_shipped_manifest_parses_and_reads_the_whole_screen(string kind)
    {
        var rules = StatusRules.ForKind(kind);

        Assert.True(rules.Classifies);
        Assert.Equal(200, rules.TailLines);
    }

    [Fact]
    public void An_alias_resolves_to_its_manifest_and_an_unknown_kind_never_classifies()
    {
        Assert.Equal("kimi", StatusRules.ForKind("kimi-cli").Name);
        Assert.False(StatusRules.ForKind("agent").Classifies);
        Assert.Null(new StatusDetector(StatusRules.ForKind("shell")).Classify(["Do you want to proceed?"], "", "", null));
    }

    [Fact]
    public void A_foreign_foreground_process_holds_and_clears_the_visible_blocker()
    {
        var detector = new StatusDetector(StatusRules.ForKind("claude"));
        var blocked = Screen("claude/blocked-bash-permission.txt");
        detector.Classify(blocked, "", "", "claude");

        var held = detector.Classify(blocked, "", "", "vim");

        Assert.Null(held);
        Assert.False(detector.LastVisibleBlocker);
    }

    [Fact]
    public void Forcing_the_same_status_keeps_a_pending_verdict_settling()
    {
        var detector = new StatusDetector(StatusRules.ForKind("claude"), initial: "working");
        var idle = new DetectClassification("idle", VisibleIdle: true);
        detector.Settle(idle, now: 0);

        detector.Force("working");
        var settled = detector.Settle(idle, now: 1);

        Assert.Equal("idle", settled);
    }

    [Theory]
    [InlineData("bottom_lines(10000)", true)]
    [InlineData("bottom_lines(10001)", false)]
    [InlineData("bottom_lines(99999999999)", false)]
    [InlineData("bottom_lines(\u0663)", false)]
    public void A_counted_region_names_at_most_ten_thousand_ascii_digit_lines(string region, bool valid)
    {
        var accepted = DetectScreen.IsValidRegion(region);

        Assert.Equal(valid, accepted);
    }

    [Fact]
    public void The_highest_priority_wins_and_file_order_breaks_ties()
    {
        var rules = StatusRules.Parse("""
            [[rules]]
            id = "low"
            state = "blocked"
            priority = 1
            contains = ["x"]
            [[rules]]
            id = "first"
            state = "working"
            priority = 5
            contains = ["x"]
            [[rules]]
            id = "second"
            state = "idle"
            priority = 5
            contains = ["x"]
            """);

        var verdict = rules.Evaluate(["x"]);

        Assert.Equal(("working", "first"), (verdict.State, verdict.RuleId));
    }

    [Fact]
    public void A_skip_rule_holds_even_over_a_lower_working_rule()
    {
        var rules = StatusRules.Parse("""
            [[rules]]
            id = "activity"
            state = "working"
            priority = 10
            contains = ["activity"]
            [[rules]]
            id = "overlay"
            state = "unknown"
            priority = 20
            skip_state_update = true
            contains = ["overlay"]
            """);

        Assert.Null(rules.Evaluate(["activity overlay"]).State);
    }

    [Fact]
    public void Nested_gates_need_all_any_and_no_not()
    {
        var rules = StatusRules.Parse("""
            [[rules]]
            id = "gate"
            state = "blocked"
            contains = ["dialog"]
            all = [{ line_regex = ['^\s*1\. yes'] }]
            any = [{ contains = ["enter"] }, { contains = ["esc"] }]
            not = [{ contains = ["scrollback"] }]
            """);

        Assert.Equal("blocked", rules.Evaluate(["Dialog", " 1. yes", "Esc"]).State);
        Assert.Null(rules.Evaluate(["Dialog", " 1. yes", "tab"]).State);
        Assert.Null(rules.Evaluate(["Dialog", " 1. yes", "Esc", "scrollback"]).State);
    }

    [Theory]
    [InlineData("this is [not toml")]
    [InlineData("[[rules]]\nid = \"r\"\nstate = \"idle\"\nregion = \"nowhere\"\ncontains = [\"x\"]")]
    [InlineData("[[rules]]\nid = \"r\"\nstate = \"sleepy\"\ncontains = [\"x\"]")]
    [InlineData("[[rules]]\nid = \"r\"\nstate = \"idle\"\nregex = [\"[unclosed\"]")]
    [InlineData("[[rules]]\nid = \"r\"\nstate = \"idle\"\ncontain = [\"typo\"]")]
    [InlineData("no_match = \"working\"\n[[rules]]\nid = \"r\"\nstate = \"idle\"\ncontains = [\"x\"]")]
    [InlineData("id = \"empty\"")]
    public void A_malformed_manifest_degrades_to_always_hold(string toml)
    {
        var rules = StatusRules.Parse(toml);

        Assert.False(rules.Classifies);
        Assert.Null(new StatusDetector(rules).Classify(["x"], "", "", null));
    }

    [Fact]
    public void Working_to_plain_idle_waits_for_three_more_sightings()
    {
        var detector = new StatusDetector(StatusRules.ForKind("codex"), hysteresisSeconds: 0, minEmitIntervalSeconds: 0);
        detector.Force("working");
        var idle = Screen("codex/idle.txt");

        var emitted = new[] { 10.0, 10.1, 10.2, 10.3 }.Select(at => detector.Observe(idle, now: at)).ToArray();

        Assert.Equal([null, null, null, "idle"], emitted);
    }

    [Fact]
    public void Working_to_plain_idle_is_released_by_the_700_ms_cap()
    {
        var detector = new StatusDetector(StatusRules.ForKind("codex"), hysteresisSeconds: 0, minEmitIntervalSeconds: 0);
        detector.Force("working");
        var idle = Screen("codex/idle.txt");

        var emitted = new[] { 10.0, 10.75 }.Select(at => detector.Observe(idle, now: at)).ToArray();

        Assert.Equal([null, "idle"], emitted);
    }

    [Fact]
    public void Visible_idle_chrome_skips_the_idle_confirmation()
    {
        var detector = new StatusDetector(StatusRules.ForKind("claude"), hysteresisSeconds: 0, minEmitIntervalSeconds: 0);
        detector.Force("working");
        var idle = Screen("claude/idle-prompt.txt");

        var emitted = new[] { 10.0, 10.1 }.Select(at => detector.Observe(idle, now: at)).ToArray();

        Assert.Equal([null, "idle"], emitted);
    }

    [Fact]
    public void A_new_status_only_emits_after_it_held_for_the_hysteresis_window()
    {
        var detector = new StatusDetector(StatusRules.ForKind("claude"), hysteresisSeconds: 0.25, minEmitIntervalSeconds: 0);
        var blocked = Screen("claude/blocked-bash-permission.txt");

        var emitted = new[] { 10.0, 10.1, 10.3, 10.6 }.Select(at => detector.Observe(blocked, now: at)).ToArray();

        Assert.Equal([null, null, "blocked", null], emitted);
        Assert.True(detector.LastVisibleBlocker);
    }

    [Fact]
    public void A_flicker_back_to_the_current_status_resets_the_pending_change()
    {
        var detector = new StatusDetector(StatusRules.ForKind("claude"), hysteresisSeconds: 0.25, minEmitIntervalSeconds: 0);

        detector.Observe(Screen("claude/blocked-bash-permission.txt"), now: 1.0);
        detector.Observe(Screen("claude/idle-prompt.txt"), now: 1.1);
        var result = detector.Observe(Screen("claude/blocked-bash-permission.txt"), now: 1.3);

        Assert.Null(result);
    }

    [Fact]
    public void Emissions_are_rate_limited()
    {
        var detector = new StatusDetector(StatusRules.ForKind("claude"), hysteresisSeconds: 0, minEmitIntervalSeconds: 1.0);
        var blocked = Screen("claude/blocked-bash-permission.txt");
        var working = Screen("claude/working-spinner.txt");
        detector.Observe(blocked, now: 1.0);
        var firstEmit = detector.Observe(blocked, now: 1.0);
        detector.Observe(working, now: 1.2);

        var tooSoon = detector.Observe(working, now: 1.4);
        var later = detector.Observe(working, now: 2.5);

        Assert.Equal("blocked", firstEmit);
        Assert.Null(tooSoon);
        Assert.Equal("working", later);
    }

    [Fact]
    public void Force_sets_the_status_and_drops_a_pending_change()
    {
        var detector = new StatusDetector(StatusRules.ForKind("claude"), hysteresisSeconds: 0, minEmitIntervalSeconds: 0);
        detector.Observe(Screen("claude/blocked-bash-permission.txt"), now: 1.0);

        detector.Force("exited");

        Assert.Equal("exited", detector.Status);
        Assert.Null(detector.Observe(Screen("claude/blocked-bash-permission.txt"), now: 1.1));
    }
}
