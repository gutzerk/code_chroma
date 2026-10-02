"""TestClient coverage for the C1 diagram endpoints and the "c1" file-change broadcast."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import diagram_json_path

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)


def _write_c1(repo: Path, c1: dict) -> None:
    c1_path = diagram_json_path(repo, "c1")
    c1_path.parent.mkdir(parents=True, exist_ok=True)
    c1_path.write_text(json.dumps(c1))


@pytest.fixture
def server_module(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)
    # No ANTHROPIC_API_KEY (set, not deleted, so a real .env's key can't leak into the bootstrap).
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")

    bridge = make_bridge(repo)
    return bridge, repo


def test_missing_c1_file_yields_empty_dict(server_module):
    bridge, repo = server_module
    # 043: undo bring-up's deterministic bootstrap so this tests a truly-missing file.
    diagram_json_path(repo, "c1").unlink(missing_ok=True)

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/c1")

    assert response.status_code == 200
    assert response.json() == {}


def test_get_c1_returns_the_written_diagram(server_module):
    bridge, repo = server_module
    c1 = {
        "type": "c1",
        "nodes": [{"id": "system", "name": "Sample Repo", "description": "A demo app."}],
        "relations": [],
    }
    _write_c1(repo, c1)

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/c1")

    body = response.json()
    assert body["nodes"][0]["name"] == "Sample Repo"
    assert body["nodes"][0]["description"] == "A demo app."


def test_get_c1_flags_an_unconvertible_legacy_file_for_regeneration(server_module):
    bridge, repo = server_module
    _write_c1(repo, {"system": "not-a-dict", "actors": []})

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/c1")

    assert response.status_code == 200
    assert response.json()["needs_regeneration"] is True


def test_get_c1_lists_the_repo_code_no_block_covers(server_module):
    bridge, repo = server_module
    c1 = {
        "type": "c1",
        "nodes": [
            {"id": "system", "name": "Sample Repo"},
            {"id": "shared", "name": "Shared", "path": "shared", "parent": "system"},
        ],
        "relations": [],
    }
    _write_c1(repo, c1)

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/c1")

    assert [entry["path"] for entry in response.json()["unmapped"]] == ["billing", "users", "web"]


def test_c1_context_never_reports_coverage_any_more(server_module):
    """042: c1 flattened to system+actors -- nothing is left for coverage_report to measure."""
    bridge, repo = server_module
    c1 = {
        "type": "c1",
        "nodes": [
            {"id": "system", "name": "Sample Repo"},
            {"id": "billing", "name": "Billing", "path": "billing", "parent": "system"},
        ],
        "relations": [],
    }
    _write_c1(repo, c1)

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/c1/context")

    assert response.json()["coverage"] is None


def test_get_c1_attaches_node_ids_to_children_paths(server_module):
    bridge, repo = server_module
    c1 = {
        "type": "c1",
        "nodes": [
            {"id": "system", "name": "Sample Repo"},
            {"id": "shared", "name": "Shared", "path": "shared", "parent": "system"},
            {"id": "ghost", "name": "Ghost", "path": "nope/missing.py", "parent": "system"},
        ],
        "relations": [],
    }
    _write_c1(repo, c1)

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/c1")

    nodes = {node["id"]: node for node in response.json()["nodes"]}
    assert nodes["shared"]["node_id"] == "dir::shared"
    assert nodes["ghost"]["node_id"] is None


def test_c1_change_pings_the_canvas(server_module):
    bridge, repo = server_module

    with TestClient(bridge.app) as client:
        bridge.diagram_watchers["c1"].stop()
        with client.websocket_connect("/repos/main/events") as websocket:
            c1 = {"system": {"name": "X", "description": ""}, "actors": [], "relationships": []}
            _write_c1(repo, c1)
            bridge.main._watchers.on_diagram_change("c1")
            message = websocket.receive_json()

    assert message == {"type": "c1"}


def test_c1_path_reports_absolute_location(server_module):
    bridge, repo = server_module

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/c1-path")

    body = response.json()
    assert response.status_code == 200
    assert body["repo_root"] == str(repo)
    assert body["c1_path"] == str(diagram_json_path(repo, "c1"))


def test_delete_c1_removes_the_file(server_module):
    bridge, repo = server_module
    path = diagram_json_path(repo, "c1")
    assert path.exists()  # 043's deterministic bootstrap already wrote one.

    with TestClient(bridge.app) as client:
        response = client.delete("/repos/default/c1")

    assert response.json() == {"deleted": True}
    assert not path.exists()


def test_delete_c1_on_a_missing_file_reports_not_deleted(server_module):
    bridge, repo = server_module
    diagram_json_path(repo, "c1").unlink(missing_ok=True)

    with TestClient(bridge.app) as client:
        response = client.delete("/repos/default/c1")

    assert response.json() == {"deleted": False}


def test_context_digest_reflects_the_fixture_repo(server_module):
    bridge, repo = server_module

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/context-digest")

    body = response.json()
    assert response.status_code == 200
    assert body["repo_name"] == repo.name


def test_no_api_key_still_bootstraps_a_system_only_c1_file(server_module):
    """043: the deterministic bootstrap needs no credential -- c1.json appears either way."""
    _server, repo = server_module

    written = json.loads(diagram_json_path(repo, "c1").read_text())
    assert written["nodes"][0]["id"] == "system"
