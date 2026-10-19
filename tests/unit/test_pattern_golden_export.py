"""The committed pattern golden (read by the C# parity test) matches the Python detector."""

import json

import pytest

from tests import pattern_golden


@pytest.mark.parametrize("repo", pattern_golden.REPOS)
def test_committed_pattern_golden_matches_a_fresh_export(repo):
    committed = json.loads(
        (pattern_golden.GOLDEN_DIR / f"{repo}.expected.json").read_text(encoding="utf-8")
    )

    fresh = json.loads(json.dumps(pattern_golden.export_repo(repo)))

    assert committed == fresh


@pytest.mark.parametrize("repo", pattern_golden.REPOS)
def test_pattern_golden_covers_every_pattern_type(repo):
    candidates = pattern_golden.export_repo(repo)["candidates"]

    types = {candidate["type"] for candidate in candidates}

    assert types == {
        "strategy", "facade", "adapter", "registry", "singleton", "observer", "repository"
    }
