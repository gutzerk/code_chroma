"""TestClient coverage for GET children on bridge/routes/graph.py, incl. binary files."""

import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import init_repo

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


@pytest.fixture
def client(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    (repo / "data.bin").write_bytes(b"\x00\x8a\xff binary not utf-8")
    init_repo(repo)

    bridge = make_bridge(repo)
    return TestClient(bridge.app), repo


def test_children_route_tolerates_binary_files(client):
    test_client, _repo = client

    response = test_client.get("/repos/default/nodes/root/children")

    assert response.status_code == 200
    binary = [c for c in response.json() if c["name"] == "data.bin"]
    assert len(binary) == 1
    assert binary[0]["source"] is None


@pytest.fixture
def docs_only_client(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    docs_dir = repo / "docs-only"
    docs_dir.mkdir()
    (docs_dir / "README.md").write_text("# Docs", encoding="utf-8")
    (docs_dir / "guide.rst").write_text("Guide", encoding="utf-8")
    init_repo(repo)

    bridge = make_bridge(repo)
    return TestClient(bridge.app), repo


def test_children_route_marks_doc_only_folder(docs_only_client):
    test_client, _repo = docs_only_client

    response = test_client.get("/repos/default/nodes/root/children")

    assert response.status_code == 200
    children = {c["name"]: c for c in response.json()}
    assert children["docs-only"]["doc_only"] is True
    assert children["billing"]["doc_only"] is False


def test_node_route_404s_for_an_unknown_id_instead_of_200_null(client):
    """A stale id (e.g. from a diagram authored before a rename) must not read as still-loading."""
    test_client, _repo = client

    response = test_client.get("/repos/default/nodes/function::does-not-exist")

    assert response.status_code == 404
