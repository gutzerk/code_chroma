"""The status rules engine: one case per manifest rule, over screens from a real session."""

from pathlib import Path

import pytest

from codechroma.bridge.agents.status import (
    STATUS_BLOCKED,
    STATUS_IDLE,
    STATUS_WORKING,
    StatusDetector,
    load_manifest,
    load_manifest_for,
)

SCREENS = Path(__file__).parent.parent / "fixtures" / "agent_screens"


def screen(name: str) -> list[str]:
    return (SCREENS / f"{name}.txt").read_text(encoding="utf-8").splitlines()


@pytest.fixture
def detector():
    return StatusDetector(load_manifest_for("claude"))


@pytest.mark.parametrize(
    ("dump", "expected"),
    [
        ("blocked-permission", STATUS_BLOCKED),
        ("blocked-select", STATUS_BLOCKED),
        ("idle-prompt", STATUS_IDLE),
        ("working-spinner", STATUS_WORKING),
    ],
)
def test_recorded_screens_classify_as_expected(detector, dump, expected):
    assert detector.classify(screen(dump), "", "", "claude") == expected


@pytest.mark.parametrize("dump", ["transient-model-picker", "transient-transcript"])
def test_transient_full_screen_modes_hold_rather_than_falling_back_to_idle(detector, dump):
    assert detector.classify(screen(dump), "", "", "claude") is None


def test_a_braille_spinner_in_the_title_reads_as_working(detector):
    assert detector.classify([""], "⠙ Claude", "", "claude") == STATUS_WORKING


def test_osc_progress_running_reads_as_working(detector):
    assert detector.classify([""], "", "running", "claude") == STATUS_WORKING


def test_osc_progress_none_reads_as_idle(detector):
    assert detector.classify([""], "", "none", "claude") == STATUS_IDLE


def test_an_unreported_progress_is_silence_rather_than_idle(detector):
    assert detector.classify(["some output nobody has a rule for"], "", "", "claude") is None


def test_a_foreign_foreground_process_holds_the_previous_status(detector):
    detector.force(STATUS_WORKING)

    assert detector.classify(screen("idle-prompt"), "", "", "vim") is None
    assert detector.status == STATUS_WORKING


def test_conflicting_rules_resolve_by_priority_not_by_input_order(detector):
    both = ["Do you want to proceed?", "❯"]

    assert detector.classify(both, "", "", "claude") == STATUS_BLOCKED
    assert detector.classify(list(reversed(both)), "", "", "claude") == STATUS_BLOCKED


def test_osc_outranks_the_screen_when_the_two_disagree(detector):
    assert detector.classify(screen("idle-prompt"), "", "running", "claude") == STATUS_WORKING


def test_a_flap_inside_the_hysteresis_window_emits_nothing(detector):
    first = detector.observe(screen("working-spinner"), process="claude", now=100.0)
    second = detector.observe(screen("idle-prompt"), process="claude", now=100.1)

    assert first is None
    assert second is None
    assert detector.status == STATUS_IDLE


def test_a_change_sustained_past_the_window_is_emitted_exactly_once(detector):
    emitted = [
        detector.observe(screen("working-spinner"), process="claude", now=at)
        for at in (100.0, 100.1, 100.4, 100.9)
    ]

    assert [status for status in emitted if status is not None] == [STATUS_WORKING]


def test_the_send_debounce_caps_changes_at_four_per_second(detector):
    detector.observe(screen("working-spinner"), process="claude", now=100.0)
    working = detector.observe(screen("working-spinner"), process="claude", now=100.3)
    detector.observe(screen("blocked-permission"), process="claude", now=100.35)
    too_soon = detector.observe(screen("blocked-permission"), process="claude", now=100.45)

    assert working == STATUS_WORKING
    assert too_soon is None


def test_a_malformed_manifest_degrades_to_always_hold(tmp_path):
    broken = tmp_path / "broken.toml"
    broken.write_text("this is not = valid = toml", encoding="utf-8")

    detector = StatusDetector(load_manifest(broken))

    assert detector.classify(screen("blocked-permission"), "", "", "claude") is None


def test_a_missing_manifest_degrades_to_always_hold(tmp_path):
    detector = StatusDetector(load_manifest(tmp_path / "nothing-here.toml"))

    assert detector.classify(screen("idle-prompt"), "", "", "claude") is None


def test_an_unparseable_pattern_is_skipped_without_losing_the_rest(tmp_path):
    manifest = tmp_path / "partial.toml"
    manifest.write_text(
        'name = "partial"\nprocess = ["claude"]\n[blocked]\nscreen_regex = ["[unclosed", "boom"]\n'
, encoding="utf-8")

    detector = StatusDetector(load_manifest(manifest))

    assert detector.classify(["boom"], "", "", "claude") == STATUS_BLOCKED


def test_a_classifier_exception_never_escapes_to_the_caller(detector, monkeypatch):
    monkeypatch.setattr(
        detector, "classify", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("boom"))
    )

    assert detector.observe(["anything"], now=100.0) is None


def test_the_shipped_manifest_names_the_claude_binaries():
    rules = load_manifest_for("claude")

    assert "claude" in rules.process
    assert rules.tail_lines == 8


def test_the_manifest_dir_resolves_under_meipass_when_frozen(monkeypatch, tmp_path):
    """A frozen app keeps data files under _MEIPASS, not beside the .py module reading them."""
    bundled = tmp_path / "codechroma_data" / "detect"
    bundled.mkdir(parents=True)
    bundled.joinpath("claude.toml").write_text(
        'name = "frozen"\nprocess = ["claude"]\n', encoding="utf-8"
    )
    monkeypatch.setattr("sys.frozen", True, raising=False)
    monkeypatch.setattr("sys._MEIPASS", str(tmp_path), raising=False)

    from codechroma.bridge.resources import resource_path

    assert load_manifest(resource_path("detect", "claude.toml")).name == "frozen"
