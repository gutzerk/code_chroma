"""TestClient coverage for the system-context diagram endpoints and its file-change broadcast."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import copy_sample_repo, diagram_json_path


def _write_c1(repo: Path, c1: dict) -> None:
    c1_path = diagram_json_path(repo, "system-context")
    c1_path.parent.mkdir(parents=True, exist_ok=True)
    c1_path.write_text(json.dumps(c1), encoding="utf-8")


@pytest.fixture
def server_module(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    copy_sample_repo(repo)
    # No ANTHROPIC_API_KEY (set, not deleted, so a real .env's key can't leak into the bootstrap).
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")

    bridge = make_bridge(repo)
    return bridge, repo


def test_missing_c1_file_yields_empty_dict(server_module):
    bridge, repo = server_module
    # 043: undo bring-up's deterministic bootstrap so this tests a truly-missing file.
    diagram_json_path(repo, "system-context").unlink(missing_ok=True)

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/system-context")

    assert response.status_code == 200
    assert response.json() == {}


def test_get_c1_returns_the_written_diagram(server_module):
    bridge, repo = server_module
    c1 = {
        "type": "system-context",
        "nodes": [{"id": "system", "name": "Sample Repo", "description": "A demo app."}],
        "relations": [],
    }
    _write_c1(repo, c1)

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/system-context")

    body = response.json()
    assert body["nodes"][0]["name"] == "Sample Repo"
    assert body["nodes"][0]["description"] == "A demo app."


def test_get_c1_flags_an_unconvertible_legacy_file_for_regeneration(server_module):
    bridge, repo = server_module
    _write_c1(repo, {"system": "not-a-dict", "actors": []})

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/system-context")

    assert response.status_code == 200
    assert response.json()["needs_regeneration"] is True


def test_get_c1_lists_the_repo_code_no_block_covers(server_module):
    bridge, repo = server_module
    c1 = {
        "type": "system-context",
        "nodes": [
            {"id": "system", "name": "Sample Repo"},
            {"id": "shared", "name": "Shared", "path": "shared", "parent": "system"},
        ],
        "relations": [],
    }
    _write_c1(repo, c1)

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/system-context")

    assert [entry["path"] for entry in response.json()["unmapped"]] == ["billing", "users", "web"]


def test_c1_context_never_reports_coverage_any_more(server_module):
    """042: c1 flattened to system+actors -- nothing is left for coverage_report to measure."""
    bridge, repo = server_module
    c1 = {
        "type": "system-context",
        "nodes": [
            {"id": "system", "name": "Sample Repo"},
            {"id": "billing", "name": "Billing", "path": "billing", "parent": "system"},
        ],
        "relations": [],
    }
    _write_c1(repo, c1)

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/system-context/context")

    assert response.json()["coverage"] is None


def test_get_c1_attaches_node_ids_to_children_paths(server_module):
    bridge, repo = server_module
    c1 = {
        "type": "system-context",
        "nodes": [
            {"id": "system", "name": "Sample Repo"},
            {"id": "shared", "name": "Shared", "path": "shared", "parent": "system"},
            {"id": "ghost", "name": "Ghost", "path": "nope/missing.py", "parent": "system"},
        ],
        "relations": [],
    }
    _write_c1(repo, c1)

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/system-context")

    nodes = {node["id"]: node for node in response.json()["nodes"]}
    assert nodes["shared"]["node_id"] == "dir::shared"
    assert nodes["ghost"]["node_id"] is None


def test_c1_change_pings_the_canvas(server_module):
    bridge, repo = server_module

    with TestClient(bridge.app) as client:
        bridge.diagram_watchers["system-context"].stop()
        with client.websocket_connect("/repos/main/events") as websocket:
            c1 = {"system": {"name": "X", "description": ""}, "actors": [], "relationships": []}
            _write_c1(repo, c1)
            bridge.main._watchers.on_diagram_change("system-context")
            message = websocket.receive_json()

    assert message == {"type": "system-context"}


def test_c1_path_reports_absolute_location(server_module):
    bridge, repo = server_module

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/system-context-path")

    body = response.json()
    assert response.status_code == 200
    assert body["repo_root"] == str(repo)
    assert body["system-context_path"] == str(diagram_json_path(repo, "system-context"))


def test_delete_c1_removes_the_file(server_module):
    bridge, repo = server_module
    path = diagram_json_path(repo, "system-context")
    assert path.exists()  # 043's deterministic bootstrap already wrote one.

    with TestClient(bridge.app) as client:
        response = client.delete("/repos/default/system-context")

    assert response.json() == {"deleted": True}
    assert not path.exists()
    with TestClient(bridge.app) as client:
        assert client.delete("/repos/default/system-context").json() == {"deleted": False}


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

    written = json.loads(diagram_json_path(repo, "system-context").read_text(encoding="utf-8"))
    assert written["nodes"][0]["id"] == "system"
