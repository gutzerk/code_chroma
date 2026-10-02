"""Unit coverage for c1_coverage: the repo subtrees no authored C1 block accounts for.

The fixture repo is billing/{service.py,reporter.go,models/invoice.py}, shared/text_utils.py,
users/service.py and web/{widget.ts,UserCard.tsx} — seven files under four top-level directories.
"""

import shutil
from pathlib import Path

import pytest

from codechroma.bridge.coverage import coverage_report, uncovered_roots
from codechroma.engine import GraphEngine
from codechroma.summarize.ai_summarizer import AISummarizer

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"

ALL_TOP_LEVEL = {"dir::billing", "dir::shared", "dir::users", "dir::web"}


def _analyze(repo):
    graph_engine = GraphEngine(summarizer=AISummarizer())
    graph_engine.analyze(str(repo))
    return graph_engine


@pytest.fixture
def engine(tmp_path):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    return _analyze(repo)


@pytest.fixture
def engine_with_config_dir(tmp_path):
    # `.idea` never reaches this module (engine.IGNORED_DIRS drops it first); `.storybook` does.
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    (repo / ".storybook").mkdir()
    (repo / ".storybook" / "config.py").write_text("x = 1\n", encoding="utf-8")
    return _analyze(repo)


def _ids(found):
    return {entry["node_id"] for entry in found.entries}


def test_nothing_authored_leaves_every_top_level_directory_uncovered(engine):
    found = uncovered_roots(engine, set())

    assert _ids(found) == ALL_TOP_LEVEL


def test_a_covered_directory_is_not_reported_and_is_not_walked_into(engine):
    found = uncovered_roots(engine, {"billing"})

    assert _ids(found) == ALL_TOP_LEVEL - {"dir::billing"}


def test_a_covered_file_covers_neither_its_siblings_nor_its_parent(engine):
    found = uncovered_roots(engine, {"billing/service.py"})

    assert _ids(found) == (ALL_TOP_LEVEL - {"dir::billing"}) | {
        "dir::billing/models",
        "component::billing/reporter.go",
    }


def test_a_partially_covered_directory_is_walked_into_rather_than_reported(engine):
    found = uncovered_roots(engine, {"billing/models"})

    assert _ids(found) == (ALL_TOP_LEVEL - {"dir::billing"}) | {
        "component::billing/reporter.go",
        "component::billing/service.py",
    }


def test_covering_every_top_level_directory_leaves_nothing_uncovered(engine):
    found = uncovered_roots(engine, {"billing", "shared", "users", "web"})

    assert found.entries == []


def test_entries_come_back_in_a_stable_depth_first_order(engine):
    found = uncovered_roots(engine, {"billing/models/invoice.py"})

    assert [entry["path"] for entry in found.entries] == [
        "billing/reporter.go",
        "billing/service.py",
        "shared",
        "users",
        "web",
    ]


def test_the_limit_caps_the_list_and_says_so(engine):
    found = uncovered_roots(engine, set(), limit=2)

    assert (len(found.entries), found.truncated) == (2, True)


def test_report_counts_every_file_when_nothing_is_authored(engine):
    report = coverage_report(engine, set())

    assert (report["total_files"], report["covered_files"], report["percent"]) == (7, 0, 0)


def test_report_counts_the_files_behind_a_covered_directory(engine):
    report = coverage_report(engine, {"billing"})

    assert (report["covered_files"], report["unmapped_files"], report["percent"]) == (3, 4, 42)


def test_report_carries_a_file_count_per_uncovered_subtree(engine):
    report = coverage_report(engine, {"shared", "users", "web"})

    assert report["entries"] == [
        {
            "node_id": "dir::billing",
            "path": "billing",
            "name": "billing",
            "level": "folder",
            "file_count": 3,
        }
    ]


def test_report_counts_an_uncovered_file_entry_as_one(engine):
    report = coverage_report(engine, {"billing/models", "shared", "users", "web"})

    assert report["entries"][0] == {
        "node_id": "component::billing/reporter.go",
        "path": "billing/reporter.go",
        "name": "reporter.go",
        "level": "file",
        "file_count": 1,
    }


def test_a_truncated_entry_list_still_reports_the_true_counts(engine):
    """The counts come off the graph, not the entries — a cut list must not overstate coverage."""
    report = coverage_report(engine, set(), limit=1)

    assert (report["truncated"], len(report["entries"])) == (True, 1)
    assert (report["unmapped_files"], report["percent"]) == (7, 0)


def test_full_coverage_reports_a_hundred_percent(engine):
    report = coverage_report(engine, {"billing", "shared", "users", "web"})

    assert (report["percent"], report["unmapped_files"], report["entries"]) == (100, 0, [])


def test_percent_is_floored_so_one_missed_file_never_reads_as_full_coverage(engine):
    report = coverage_report(engine, {"billing", "shared", "users"})

    assert (report["covered_files"], report["total_files"], report["percent"]) == (5, 7, 71)


def test_a_dot_directory_is_scored_out_of_the_report_on_both_sides(engine_with_config_dir):
    """Nobody spends a block on IDE config, so it must not drag the percentage down."""
    report = coverage_report(engine_with_config_dir, {"billing", "shared", "users", "web"})

    assert (report["percent"], report["total_files"], report["entries"]) == (100, 7, [])


def test_a_dot_directory_stays_reachable_on_the_canvas(engine_with_config_dir):
    """Only the metric drops it — uncovered_roots feeds the canvas, where reachability is."""
    found = uncovered_roots(engine_with_config_dir, {"billing", "shared", "users", "web"})

    assert _ids(found) == {"dir::.storybook"}
