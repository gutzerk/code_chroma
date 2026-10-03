"""Unit coverage for resolve_target: mapping a (file, symbol) target to the nearest live node."""

import shutil
from pathlib import Path

import pytest

from codechroma.bridge.plan_resolver import ROOT_NODE_ID, resolve_target
from codechroma.engine import ROOT_SENTINEL, GraphEngine
from codechroma.summarize.ai_summarizer import AISummarizer

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


@pytest.fixture
def engine(tmp_path):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    graph_engine = GraphEngine(summarizer=AISummarizer())
    graph_engine.analyze(str(repo))
    return graph_engine


@pytest.mark.parametrize(
    "source_file,symbol,expected_id,expected_resolution",
    [
        ("shared/text_utils.py", "slugify", "shared/text_utils.py::function::slugify", "exact"),
        ("shared/text_utils.py", "truncate", "component::shared/text_utils.py", "parent"),
        (
            "users/service.py", "UserService.delete_user",
            "users/service.py::class::UserService", "parent",
        ),
        ("users/tokens.py", "validate_token", "dir::users", "ancestor"),
        ("billing/service.py", None, "component::billing/service.py", "exact"),
    ],
)
def test_resolve_target(engine, source_file, symbol, expected_id, expected_resolution):
    node_id, resolution = resolve_target(engine, source_file, symbol)

    assert node_id == expected_id
    assert resolution == expected_resolution


def test_brand_new_top_level_path_falls_back_to_a_root_node(engine):
    node_id, resolution = resolve_target(engine, "not-a-real-dir/new_file.py", "new_symbol")

    systems = engine.get_children(ROOT_SENTINEL)
    expected = systems[0].id if systems else ROOT_NODE_ID
    assert node_id == expected
    assert resolution == "ancestor"
