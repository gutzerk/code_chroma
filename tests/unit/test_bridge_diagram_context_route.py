"""TestClient coverage for the unified GET /repos/{id}/{kind}/context envelope (037)."""

import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from codechroma.diagrams import library

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)


@pytest.fixture
def server_module(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    monkeypatch.setenv(library.DIAGRAM_TYPES_DIR_ENV, str(tmp_path / "diagram-types"))

    bridge = make_bridge(repo)
    return bridge, repo


def test_c1_context_has_neither_coverage_nor_generation_data(server_module):
    """042: flat c1 has no coverage data (see test_diagrams_registry.py)."""
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/c1/context").json()

    assert payload["coverage"] is None
    assert payload["staleness"] is None
    assert payload["generation_data"] is None


def test_patterns_context_has_staleness_and_generation_data_but_no_coverage(server_module):
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/patterns/context").json()

    assert payload["coverage"] is None
    assert payload["staleness"] is not None
    assert "classes" in payload["generation_data"]


def test_impact_context_has_generation_data_but_no_coverage_or_staleness(server_module):
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/impact/context").json()

    assert payload["coverage"] is None
    assert payload["staleness"] is None
    assert "nodes" in payload["generation_data"]


def test_sequence_context_has_a_generation_data_scaffold_with_no_trace(server_module):
    """With no recorded trace, the sequence envelope still carries the (empty) traces list."""
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/sequence/context").json()

    assert payload["coverage"] is None
    assert payload["staleness"] is None
    assert payload["generation_data"]["traces"] == []


def test_unknown_kind_context_is_a_404(server_module):
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/not-a-kind/context")

    assert response.status_code == 404


def test_custom_type_context_is_all_null_by_default(server_module):
    bridge, _repo = server_module
    library.save_type(
        {
            "id": "data-flow",
            "title": "Data flow",
            "style": "boxes-arrows",
            "layout": {"direction": "LR"},
            "grouping": {"enabled": False},
            "relation_kinds": [],
            "instructions": "One box per component.",
        }
    )

    with TestClient(bridge.app) as client:
        payload = client.get("/repos/default/custom/data-flow/context").json()

    assert payload == {"coverage": None, "staleness": None, "generation_data": None}
