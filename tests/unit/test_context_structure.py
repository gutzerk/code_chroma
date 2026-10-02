"""Unit coverage for build_structure: the bounded path menu a C1 author copies node ids from."""

import shutil
from pathlib import Path

import pytest

from codechroma.context.structure import UnknownRootError, build_structure
from codechroma.engine import GraphEngine
from codechroma.summarize.ai_summarizer import AISummarizer

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


@pytest.fixture
def engine(tmp_path):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    graph_engine = GraphEngine(summarizer=AISummarizer())
    graph_engine.analyze(str(repo))
    return graph_engine


def _flatten(nodes):
    for entry in nodes:
        yield entry
        yield from _flatten(entry.get("children", []))


def test_lists_every_top_level_entry_with_its_graph_node_id(engine):
    structure = build_structure(engine)

    assert {entry["node_id"] for entry in structure["nodes"]} == {
        "dir::billing",
        "dir::shared",
        "dir::users",
        "dir::web",
    }


def test_each_entry_carries_the_repo_relative_path_its_node_id_encodes(engine):
    structure = build_structure(engine, depth=2)

    billing = next(entry for entry in structure["nodes"] if entry["name"] == "billing")
    assert [child["path"] for child in billing["children"]] == [
        "billing/models",
        "billing/reporter.go",
        "billing/service.py",
    ]


def test_folders_sort_before_files(engine):
    structure = build_structure(engine, depth=2)

    billing = next(entry for entry in structure["nodes"] if entry["name"] == "billing")
    assert [child["level"] for child in billing["children"]] == ["folder", "file", "file"]


def test_files_are_leaves_and_deeper_symbol_levels_are_never_listed(engine):
    structure = build_structure(engine, depth=5)

    files = [entry for entry in _flatten(structure["nodes"]) if entry["level"] == "file"]
    assert files and all("children" not in entry for entry in files)


def test_no_entry_carries_source_code(engine):
    structure = build_structure(engine, depth=5)

    assert all("source" not in entry for entry in _flatten(structure["nodes"]))


def test_depth_limit_marks_the_cut_subtree_truncated(engine):
    structure = build_structure(engine, depth=1)

    billing = next(entry for entry in structure["nodes"] if entry["name"] == "billing")
    assert structure["truncated"] is True
    assert billing["truncated"] is True
    assert billing["child_count"] == 3
    assert "children" not in billing


def test_root_parameter_returns_just_that_subtree(engine):
    structure = build_structure(engine, root_id="dir::billing", depth=1)

    assert [entry["node_id"] for entry in structure["nodes"]] == [
        "dir::billing/models",
        "component::billing/reporter.go",
        "component::billing/service.py",
    ]


def test_max_children_caps_a_wide_level_and_marks_it_truncated(engine):
    structure = build_structure(engine, max_children=1)

    assert len(structure["nodes"]) == 1
    assert structure["truncated"] is True


def test_max_nodes_budget_bounds_the_whole_payload(engine):
    structure = build_structure(engine, depth=5, max_nodes=3)

    assert len(list(_flatten(structure["nodes"]))) == 3
    assert structure["truncated"] is True


def test_depth_is_clamped_to_the_hard_maximum(engine):
    structure = build_structure(engine, depth=99)

    assert structure["depth"] == 5


def test_folder_summary_is_a_single_trimmed_sentence(engine):
    structure = build_structure(engine, depth=1)

    summaries = [entry["summary"] for entry in structure["nodes"]]
    assert all(text is None or (len(text) <= 160 and ". " not in text) for text in summaries)


def test_unknown_root_raises_unknown_root_error(engine):
    with pytest.raises(UnknownRootError):
        build_structure(engine, root_id="dir::nope")
