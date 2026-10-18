using CodeChroma.Bridge.Agents;

namespace CodeChroma.Bridge.Tests.Agents;

public class StatusDetectorTests
{
    private static StatusRules Claude() => StatusRules.ForKind("claude");

    [Fact]
    public void The_shipped_claude_manifest_loads_with_all_four_sections()
    {
        var rules = Claude();

        Assert.Equal("claude", rules.Name);
        Assert.Equal(["claude", "claude-code", "node"], rules.Process);
        Assert.Equal(8, rules.TailLines);
        Assert.NotEmpty(rules.Section("blocked").ScreenRegex);
        Assert.NotEmpty(rules.Section("working").TitleRegex);
        Assert.NotEmpty(rules.Section("idle").ScreenRegex);
        Assert.NotEmpty(rules.Transient.ScreenRegex);
    }

    [Fact]
    public void An_unknown_kind_gets_rules_that_never_classify()
    {
        var detector = new StatusDetector(StatusRules.ForKind("shell"));

        Assert.Null(detector.Classify(["Do you want to proceed?"], "", "", null));
    }

    [Theory]
    [InlineData("Do you want to proceed?", "blocked")]
    [InlineData("  ❯ 1. Yes", "blocked")]
    [InlineData("✳ thinking (esc to interrupt)", "working")]
    [InlineData("❯", "idle")]
    [InlineData("nothing recognizable", null)]
    public void Screen_rules_classify_the_bottom_lines(string line, string? expected)
    {
        var detector = new StatusDetector(Claude());

        Assert.Equal(expected, detector.Classify([line], "", "", null));
    }

    [Fact]
    public void The_braille_spinner_in_the_title_means_working_and_beats_the_screen()
    {
        var detector = new StatusDetector(Claude());

        Assert.Equal("working", detector.Classify(["❯"], "⠇ doing it", "", null));
    }

    [Theory]
    [InlineData("running", "working")]
    [InlineData("none", "idle")]
    public void Osc_progress_is_a_status_signal(string progress, string expected)
    {
        var detector = new StatusDetector(Claude());

        Assert.Equal(expected, detector.Classify([], "", progress, null));
    }

    [Fact]
    public void A_foreign_foreground_process_holds_the_status()
    {
        var detector = new StatusDetector(Claude());

        Assert.Null(detector.Classify(["Do you want to proceed?"], "", "", "vim"));
        Assert.Equal("blocked", detector.Classify(["Do you want to proceed?"], "", "", "claude"));
    }

    [Fact]
    public void A_transient_full_screen_mode_holds_the_status()
    {
        var detector = new StatusDetector(Claude());

        Assert.Null(detector.Classify(["Select a model", "❯"], "", "", null));
    }

    [Fact]
    public void A_new_status_only_emits_after_it_held_for_the_hysteresis_window()
    {
        var detector = new StatusDetector(Claude(), hysteresisSeconds: 0.25, minEmitIntervalSeconds: 0);
        string[] blocked = ["Do you want to proceed?"];

        var first = detector.Observe(blocked, now: 10.0);
        var early = detector.Observe(blocked, now: 10.1);
        var settled = detector.Observe(blocked, now: 10.3);
        var repeat = detector.Observe(blocked, now: 10.6);

        Assert.Null(first);
        Assert.Null(early);
        Assert.Equal("blocked", settled);
        Assert.Null(repeat);
        Assert.Equal("blocked", detector.Status);
    }

    [Fact]
    public void A_flicker_back_to_the_current_status_resets_the_pending_change()
    {
        var detector = new StatusDetector(Claude(), hysteresisSeconds: 0.25, minEmitIntervalSeconds: 0);

        detector.Observe(["Do you want to proceed?"], now: 1.0);
        detector.Observe(["❯"], now: 1.1);
        var result = detector.Observe(["Do you want to proceed?"], now: 1.2);

        Assert.Null(result);
    }

    [Fact]
    public void Emissions_are_rate_limited()
    {
        var detector = new StatusDetector(Claude(), hysteresisSeconds: 0, minEmitIntervalSeconds: 1.0);

        detector.Observe(["Do you want to proceed?"], now: 1.0);
        var firstEmit = detector.Observe(["Do you want to proceed?"], now: 1.0);
        detector.Observe(["esc to interrupt"], now: 1.2);
        var tooSoon = detector.Observe(["esc to interrupt"], now: 1.4);
        var later = detector.Observe(["esc to interrupt"], now: 2.5);

        Assert.Equal("blocked", firstEmit);
        Assert.Null(tooSoon);
        Assert.Equal("working", later);
    }

    [Fact]
    public void Force_sets_the_status_and_clears_the_pending_change()
    {
        var detector = new StatusDetector(Claude());

        detector.Force("exited");

        Assert.Equal("exited", detector.Status);
    }

    [Fact]
    public void A_malformed_manifest_degrades_to_rules_that_never_classify()
    {
        var rules = StatusRules.Parse("this is [not toml");

        Assert.Empty(rules.Process);
        Assert.Null(new StatusDetector(rules).Classify(["anything"], "", "", null));
    }

    [Fact]
    public void The_toml_reader_handles_comments_escapes_and_multiline_arrays()
    {
        var rules = StatusRules.Parse("""
            name = "x"  # trailing comment
            process = ["a", "b#c"]
            tail_lines = 3

            [blocked]
            screen_regex = [
              "one\\bTwo",   # comment between items
              "q\"uote",
            ]
            """);

        Assert.Equal(["a", "b#c"], rules.Process);
        Assert.Equal(3, rules.TailLines);
        Assert.Equal(2, rules.Section("blocked").ScreenRegex.Count);
        Assert.Equal(@"one\bTwo", rules.Section("blocked").ScreenRegex[0].ToString());
        Assert.Equal("q\"uote", rules.Section("blocked").ScreenRegex[1].ToString());
    }
}
