"""Unit coverage for the codechroma-review-diagram self-check, explanatory axis (037, T043).

Replaces `test_c1_review_check_script.py`. The judgmental (impact) axis was removed rather than kept
half-wired (038 follow-up), so the script (and this coverage) only inspects `axis="explanatory"`.
"""

import importlib.util
import subprocess
import sys
from pathlib import Path

SCRIPT = (
    Path(__file__).parent.parent.parent
    / ".claude"
    / "skills"
    / "codechroma-review-diagram"
    / "scripts"
    / "check_review.py"
)


def _load_script():
    """Loaded by path — the skill scripts live outside the importable package tree on purpose."""
    spec = importlib.util.spec_from_file_location("check_review", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _explanatory_review(entries=None, ghosts=None, **overrides):
    review = {
        "fingerprint": "f",
        "stale": False,
        "has_review": True,
        "axis": "explanatory",
        "entries": entries if entries is not None else [],
        "ghosts": ghosts if ghosts is not None else [],
    }
    review.update(overrides)
    return review


def test_an_explanatory_review_the_bridge_resolved_cleanly_reports_no_problems():
    module = _load_script()
    review = _explanatory_review(entries=[{
        "node_id": "system/engine",
        "explanation": {"before": "x", "after": "y", "change_count": 1},
    }])
    authored = {"blocks": [{"block": "system/engine", "before": "x", "after": "y"}]}

    assert module._inspect_explanatory(review, authored, "impact") == ([], [])


def test_a_block_trail_the_bridge_dropped_is_reported_broken():
    module = _load_script()
    authored = {"blocks": [{"block": "system/typo", "before": "x"}]}

    problems, _advisories = module._inspect_explanatory(_explanatory_review(), authored, "impact")

    assert problems == ["BROKEN system/typo is not a block in the diagram -- check the node_id"]


def test_a_fingerprint_that_no_longer_matches_is_reported_stale():
    module = _load_script()

    problems, _advisories = module._inspect_explanatory(
        _explanatory_review(stale=True), {}, "impact"
    )

    assert problems[0].startswith("STALE")


def test_no_fingerprint_at_all_is_reported():
    module = _load_script()

    problems, _advisories = module._inspect_explanatory(
        _explanatory_review(fingerprint=""), {}, "impact"
    )

    assert problems == ["NOFINGERPRINT"]


def test_a_ghost_under_a_parent_the_bridge_dropped_is_reported():
    module = _load_script()
    authored = {"ghosts": [{"parent": "system/gone", "id": "old", "name": "Old"}]}

    problems, _advisories = module._inspect_explanatory(_explanatory_review(), authored, "impact")

    assert problems == ["BROKEN ghost old names an unknown parent block"]


def test_a_changed_block_with_no_prose_is_advisory_only_not_a_failure():
    module = _load_script()
    review = _explanatory_review(entries=[{
        "node_id": "system/engine", "explanation": {"change_count": 3},
    }])

    problems, advisories = module._inspect_explanatory(review, {}, "impact")

    assert problems == []
    assert advisories == ["UNEXPLAINED system/engine has changes but no before/after"]


def test_a_review_missing_from_the_bridge_entirely_is_reported():
    module = _load_script()

    problems, _advisories = module._inspect_explanatory(
        _explanatory_review(has_review=False, fingerprint=""), {}, "impact"
    )

    assert problems[0].startswith("NOREVIEW")


def test_an_unreachable_bridge_exits_two():
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--url", "http://127.0.0.1:1", "--kind", "impact"],
        capture_output=True,
        text=True,
    )

    assert result.returncode == 2
