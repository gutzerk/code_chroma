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


def test_existing_function_resolves_exactly(engine):
    node_id, resolution = resolve_target(engine, "shared/text_utils.py", "slugify")

    assert node_id == "shared/text_utils.py::function::slugify"
    assert resolution == "exact"


def test_missing_symbol_in_existing_file_resolves_to_the_component(engine):
    node_id, resolution = resolve_target(engine, "shared/text_utils.py", "truncate")

    assert node_id == "component::shared/text_utils.py"
    assert resolution == "parent"


def test_new_method_resolves_to_the_existing_class(engine):
    node_id, resolution = resolve_target(engine, "users/service.py", "UserService.delete_user")

    assert node_id == "users/service.py::class::UserService"
    assert resolution == "parent"


def test_new_file_in_existing_dir_resolves_to_the_directory(engine):
    node_id, resolution = resolve_target(engine, "users/tokens.py", "validate_token")

    assert node_id == "dir::users"
    assert resolution == "ancestor"


def test_file_only_target_resolves_exactly_to_its_component(engine):
    node_id, resolution = resolve_target(engine, "billing/service.py", None)

    assert node_id == "component::billing/service.py"
    assert resolution == "exact"


def test_brand_new_top_level_path_falls_back_to_a_root_node(engine):
    node_id, resolution = resolve_target(engine, "not-a-real-dir/new_file.py", "new_symbol")

    systems = engine.get_children(ROOT_SENTINEL)
    expected = systems[0].id if systems else ROOT_NODE_ID
    assert node_id == expected
    assert resolution == "ancestor"
