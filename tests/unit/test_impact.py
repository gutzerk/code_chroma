"""Pure graph-traversal tests of resolve_impact: hop, truncation, missing-seed drop."""

import shutil
import subprocess
from pathlib import Path

import pytest

from codechroma.bridge.impact import resolve_impact
from codechroma.dependencies.digest import build_dependency_index
from codechroma.engine import GraphEngine
from codechroma.summarize.ai_summarizer import AISummarizer

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"

SLUGIFY = "shared/text_utils.py::function::slugify"


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, root)
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)
    return root


@pytest.fixture
def graph_index(repo):
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(repo))
    graph = engine.snapshot()
    return graph, build_dependency_index(graph)


def test_hop_zero_returns_only_the_seeds(graph_index):
    graph, index = graph_index

    payload = resolve_impact(graph, index, [SLUGIFY], hop=0)

    assert [node["id"] for node in payload["nodes"]] == [SLUGIFY]
    assert payload["relations"] == []


def test_hop_expands_to_callers_and_callees(graph_index):
    graph, index = graph_index

    payload = resolve_impact(graph, index, [SLUGIFY], hop=1)

    node_ids = {node["id"] for node in payload["nodes"]}
    # One hop reaches slugify's callers; a second hop would reach their own callers too.
    assert "users/service.py::function::UserService.create_user" in node_ids
    assert "users/service.py::class::UserService" in node_ids
    # No node stops being a seed just because a neighbour reached it.
    seed = next(node for node in payload["nodes"] if node["id"] == SLUGIFY)
    assert seed["seed"] is True


def test_missing_seed_is_dropped_silently(graph_index):
    graph, index = graph_index

    payload = resolve_impact(graph, index, [SLUGIFY, "does/not/exist::x"])

    assert payload["seed_count"] == 1
    node_ids = {node["id"] for node in payload["nodes"]}
    assert "does/not/exist::x" not in node_ids
    assert SLUGIFY in node_ids


def test_max_nodes_truncates_and_flags(graph_index):
    graph, index = graph_index

    payload = resolve_impact(graph, index, [SLUGIFY], hop=3, max_nodes=2)

    assert len(payload["nodes"]) <= 2
    assert payload["truncated"] is True
    assert payload["node_count"] <= 2
