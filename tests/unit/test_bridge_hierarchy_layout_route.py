"""TestClient coverage for the hierarchy layout (saved top-level box positions) endpoints."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

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

    bridge = make_bridge(repo)
    return bridge, repo


def test_missing_layout_file_yields_empty_dict(server_module):
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/hierarchy/layout")

    assert response.status_code == 200
    assert response.json() == {}


def test_post_layout_writes_file_and_round_trips(server_module):
    bridge, repo = server_module
    layout = {"dir::billing": {"x": 12.5, "y": -30.0}, "dir::shared": {"x": 100.0, "y": 40.0}}

    with TestClient(bridge.app) as client:
        post = client.post("/repos/default/hierarchy/layout", json=layout)
        get = client.get("/repos/default/hierarchy/layout")

    assert post.status_code == 200
    assert get.json() == layout
    on_disk = json.loads(
        (repo / ".codechroma" / "hierarchy-layout.json").read_text(encoding="utf-8")
    )
    assert on_disk == layout


def test_post_layout_creates_codechroma_dir_when_absent(server_module):
    bridge, repo = server_module
    shutil.rmtree(repo / ".codechroma", ignore_errors=True)

    with TestClient(bridge.app) as client:
        response = client.post(
            "/repos/default/hierarchy/layout", json={"dir::billing": {"x": 1, "y": 2}}
        )

    assert response.status_code == 200
    assert (repo / ".codechroma" / "hierarchy-layout.json").exists()


def test_post_layout_is_allowed_on_a_read_only_pr_workspace(server_module):
    """Must behave like the c1/patterns layout save routes, which use the same `Ws` guard."""
    bridge, repo = server_module
    bridge.services.registry.register("pr-7", repo, read_only=True)

    with TestClient(bridge.app) as client:
        response = client.post(
            "/repos/pr-7/hierarchy/layout", json={"dir::billing": {"x": 1, "y": 2}}
        )

    assert response.status_code == 200


def test_post_layout_sanitizes_junk_entries(server_module):
    bridge, _repo = server_module
    dirty = {
        "dir::billing": {"x": 5, "y": 6},
        "no-coords": {"x": "nope", "y": 1},
        "not-an-object": 42,
        "bool-coords": {"x": True, "y": 3},
    }

    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/hierarchy/layout", json=dirty)

    assert response.json() == {"dir::billing": {"x": 5.0, "y": 6.0}}


def test_post_layout_tolerates_a_malformed_body(server_module):
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        response = client.post(
            "/repos/default/hierarchy/layout",
            content=b"not json",
            headers={"content-type": "application/json"},
        )

    assert response.status_code == 200
    assert response.json() == {}
