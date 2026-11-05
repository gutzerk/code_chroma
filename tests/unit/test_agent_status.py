"""The herdr-style status rule engine, over the screens shared with the C# bridge tests."""

import json
from pathlib import Path

import pytest

from codechroma.bridge.agents.status import (
    STATUS_BLOCKED,
    STATUS_IDLE,
    STATUS_WORKING,
    Classification,
    DetectScreen,
    StatusDetector,
    StatusRules,
    load_manifest,
    load_manifest_for,
    parse_manifest,
)

SCREENS = Path(__file__).parent.parent / "fixtures" / "agent_screens"
CASES = json.loads((SCREENS / "cases.json").read_text(encoding="utf-8"))
REGIONS = json.loads((SCREENS / "regions.json").read_text(encoding="utf-8"))


def screen(name: str) -> list[str]:
    return (SCREENS / name).read_text(encoding="utf-8").splitlines()


def fast(kind: str) -> StatusDetector:
    return StatusDetector(load_manifest_for(kind), hysteresis_seconds=0, min_emit_interval=0)


def case_lines(case: dict) -> list[str]:
    return screen(case["screen"]) if "screen" in case else case.get("lines", [])


def case_id(case: dict) -> str:
    return f"{case['kind']}:{case.get('screen', '-')}:{case.get('title', '')}"


@pytest.mark.parametrize("case", CASES, ids=[case_id(case) for case in CASES])
def test_shared_screens_classify_as_expected(case):
    detector = StatusDetector(load_manifest_for(case["kind"]))

    title, progress = case.get("title", ""), case.get("progress", "")

    state = detector.classify(case_lines(case), title, progress, None)

    assert state == case["expected"]
    assert detector.last_classification.rule_id == case["rule"]
    assert detector.last_visible_blocker == case["visible_blocker"]


@pytest.mark.parametrize("case", REGIONS, ids=[case["region"] for case in REGIONS])
def test_shared_regions_slice_the_screen_like_herdr(case):
    region = DetectScreen(case["lines"]).region(case["region"], "the title", "running")

    assert region == case["expected"]


@pytest.mark.parametrize("kind", ["claude", "codex", "kimi", "gemini"])
def test_every_shipped_manifest_parses_and_reads_the_whole_screen(kind):
    rules = load_manifest_for(kind)

    assert rules.classifies
    assert rules.tail_lines == 200


def test_an_alias_resolves_to_its_manifest():
    assert load_manifest_for("kimi-cli").name == "kimi"
    assert not load_manifest_for("agent").classifies


def test_a_foreign_foreground_process_holds_and_clears_the_visible_blocker():
    detector = StatusDetector(load_manifest_for("claude"))
    blocked = screen("claude/blocked-bash-permission.txt")
    detector.classify(blocked, "", "", "claude")

    held = detector.classify(blocked, "", "", "vim")

    assert held is None
    assert not detector.last_visible_blocker


def test_forcing_the_same_status_keeps_a_pending_verdict_settling():
    detector = StatusDetector(load_manifest_for("claude"), initial=STATUS_WORKING)
    idle = Classification(state=STATUS_IDLE, visible_idle=True)
    detector.settle(idle, now=0)

    detector.force(STATUS_WORKING)
    settled = detector.settle(idle, now=1)

    assert settled == STATUS_IDLE


@pytest.mark.parametrize(
    ("region", "valid"),
    [
        ("bottom_lines(10000)", True),
        ("bottom_lines(10001)", False),
        ("bottom_lines(99999999999)", False),
        ("bottom_lines(\u0663)", False),
    ],
)
def test_a_counted_region_names_at_most_ten_thousand_ascii_digit_lines(region, valid):
    manifest = f'[[rules]]\nid = "r"\nstate = "idle"\nregion = "{region}"\ncontains = ["x"]\n'

    try:
        parse_manifest(manifest)
        accepted = True
    except ValueError:
        accepted = False

    assert accepted == valid


def test_the_highest_priority_wins_and_file_order_breaks_ties():
    rules = parse_manifest(
        """
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
        """
    )

    verdict = rules.evaluate(["x"])

    assert (verdict.state, verdict.rule_id) == (STATUS_WORKING, "first")


def test_a_skip_rule_holds_even_over_a_lower_working_rule():
    rules = parse_manifest(
        """
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
        """
    )

    assert rules.evaluate(["activity overlay"]).state is None


def test_nested_gates_need_all_any_and_no_not():
    rules = parse_manifest(
        """
        [[rules]]
        id = "gate"
        state = "blocked"
        contains = ["dialog"]
        all = [{ line_regex = ['^\\s*1\\. yes'] }]
        any = [{ contains = ["enter"] }, { contains = ["esc"] }]
        not = [{ contains = ["scrollback"] }]
        """
    )

    assert rules.evaluate(["Dialog", " 1. yes", "Esc"]).state == STATUS_BLOCKED
    assert rules.evaluate(["Dialog", " 1. yes", "tab"]).state is None
    assert rules.evaluate(["Dialog", " 1. yes", "Esc", "scrollback"]).state is None


@pytest.mark.parametrize(
    "text",
    [
        "this is not = valid = toml",
        '[[rules]]\nid = "r"\nstate = "idle"\nregion = "nowhere"\ncontains = ["x"]',
        '[[rules]]\nid = "r"\nstate = "sleepy"\ncontains = ["x"]',
        '[[rules]]\nid = "r"\nstate = "idle"\nregex = ["[unclosed"]',
        '[[rules]]\nid = "r"\nstate = "idle"\ncontain = ["typo"]',
        'no_match = "working"\n[[rules]]\nid = "r"\nstate = "idle"\ncontains = ["x"]',
        'id = "empty"',
    ],
    ids=["bad-toml", "region", "state", "regex", "unknown-key", "no-match", "no-rules"],
)
def test_a_malformed_manifest_degrades_to_always_hold(tmp_path, text):
    manifest = tmp_path / "broken.toml"
    manifest.write_text(text, encoding="utf-8")

    rules = load_manifest(manifest)

    assert not rules.classifies
    assert StatusDetector(rules).classify(["x"], "", "", None) is None


def test_a_missing_manifest_degrades_to_always_hold(tmp_path):
    detector = StatusDetector(load_manifest(tmp_path / "nothing-here.toml"))

    assert detector.classify(screen("claude/idle-prompt.txt"), "", "", "claude") is None


def test_working_to_plain_idle_waits_for_three_more_sightings():
    detector = fast("codex")
    detector.force(STATUS_WORKING)
    idle = screen("codex/idle.txt")

    emitted = [detector.observe(idle, now=at) for at in (10.0, 10.1, 10.2, 10.3)]

    assert emitted == [None, None, None, STATUS_IDLE]


def test_working_to_plain_idle_is_released_by_the_700_ms_cap():
    detector = fast("codex")
    detector.force(STATUS_WORKING)
    idle = screen("codex/idle.txt")

    emitted = [detector.observe(idle, now=at) for at in (10.0, 10.75)]

    assert emitted == [None, STATUS_IDLE]


def test_visible_idle_chrome_skips_the_idle_confirmation():
    detector = fast("claude")
    detector.force(STATUS_WORKING)
    idle = screen("claude/idle-prompt.txt")

    emitted = [detector.observe(idle, now=at) for at in (10.0, 10.1)]

    assert emitted == [None, STATUS_IDLE]


def test_a_flap_inside_the_hysteresis_window_emits_nothing():
    detector = StatusDetector(load_manifest_for("claude"))

    first = detector.observe(screen("claude/working-spinner.txt"), process="claude", now=100.0)
    second = detector.observe(screen("claude/idle-prompt.txt"), process="claude", now=100.1)

    assert (first, second) == (None, None)
    assert detector.status == STATUS_IDLE


def test_a_change_sustained_past_the_window_is_emitted_exactly_once():
    detector = StatusDetector(load_manifest_for("claude"))
    working = screen("claude/working-spinner.txt")
    moments = (100.0, 100.1, 100.4, 100.9)

    emitted = [detector.observe(working, process="claude", now=at) for at in moments]

    assert [status for status in emitted if status is not None] == [STATUS_WORKING]


def test_the_send_debounce_caps_changes_at_four_per_second():
    detector = StatusDetector(load_manifest_for("claude"))
    blocked = screen("claude/blocked-bash-permission.txt")
    detector.observe(screen("claude/working-spinner.txt"), process="claude", now=100.0)
    working = detector.observe(screen("claude/working-spinner.txt"), process="claude", now=100.3)
    detector.observe(blocked, process="claude", now=100.35)

    too_soon = detector.observe(blocked, process="claude", now=100.45)

    assert working == STATUS_WORKING
    assert too_soon is None
    assert detector.last_visible_blocker


def test_a_classifier_exception_never_escapes_to_the_caller(monkeypatch):
    detector = StatusDetector(load_manifest_for("claude"))
    monkeypatch.setattr(
        detector, "classify", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("boom"))
    )

    assert detector.observe(["anything"], now=100.0) is None


def test_force_sets_the_status_and_drops_a_pending_change():
    detector = fast("claude")
    detector.observe(screen("claude/blocked-bash-permission.txt"), now=1.0)

    detector.force("exited")

    assert detector.status == "exited"
    assert detector.observe(screen("claude/blocked-bash-permission.txt"), now=1.1) is None


def test_empty_rules_never_classify():
    rules = StatusRules()

    assert not rules.classifies
    assert rules.evaluate(["Do you want to proceed?"]).state is None
