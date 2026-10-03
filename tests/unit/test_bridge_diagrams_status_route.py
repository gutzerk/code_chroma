"""TestClient coverage for GET /repos/{id}/diagrams/status -- the "Diagrams" menu's readiness."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import diagram_json_path


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload))


@pytest.fixture
def server_module(bridge_repo, make_bridge, monkeypatch, tmp_path):
    # Isolate from the real, cross-project ~/.codechroma/diagram-types library.
    isolated_library = tmp_path / "diagram-types"
    monkeypatch.setattr("codechroma.diagrams.library.library_dir", lambda: isolated_library)
    monkeypatch.setattr("codechroma.bridge.workspaces.bootstrap_all_if_missing", lambda _ws: None)
    bridge = make_bridge(bridge_repo)
    return bridge, bridge_repo


def test_empty_repo_reports_nothing_ready(server_module):
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/diagrams/status")

    assert response.json() == {
        "c1": {"ready": False, "fingerprint": None},
        "patterns": {"ready": False, "fingerprint": None},
        "impact": {"ready": False, "fingerprint": None},
        "epics": {"ready": False, "fingerprint": None},
        "sequence": {"ready": False, "fingerprint": None},
    }


def test_written_c1_reports_ready(server_module):
    bridge, repo = server_module
    _write_json(diagram_json_path(repo, "c1"), {"system": {"name": "Sample"}})

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/diagrams/status")

    assert response.json()["c1"]["ready"] is True
    assert response.json()["c1"]["fingerprint"] is not None
    assert response.json()["patterns"] == {"ready": False, "fingerprint": None}


def test_c1_fingerprint_changes_when_the_file_is_edited_in_place(server_module):
    # Lets a client spot an in-place edit; DrawDiagramButton reruns the stale check.
    bridge, repo = server_module
    _write_json(
        diagram_json_path(repo, "c1"),
        {"type": "c1", "nodes": [], "relations": []},
    )
    with TestClient(bridge.app) as client:
        before = client.get("/repos/default/diagrams/status").json()["c1"]["fingerprint"]

    _write_json(
        diagram_json_path(repo, "c1"),
        {"type": "c1", "nodes": [{"id": "system", "name": "Sample"}], "relations": []},
    )
    with TestClient(bridge.app) as client:
        after = client.get("/repos/default/diagrams/status").json()["c1"]["fingerprint"]

    assert before != after


def test_deleting_a_diagram_flips_its_ready_flag_back_to_false(server_module):
    # No cache to invalidate: has_artifact() reads the file live, so unlinking it is enough.
    bridge, repo = server_module
    _write_json(diagram_json_path(repo, "c1"), {"system": {"name": "Sample"}})

    with TestClient(bridge.app) as client:
        before = client.get("/repos/default/diagrams/status").json()["c1"]["ready"]
        client.delete("/repos/default/c1")
        after = client.get("/repos/default/diagrams/status").json()["c1"]["ready"]

    assert before is True
    assert after is False


def test_saved_custom_type_reports_readiness_per_instance(server_module, tmp_path):
    bridge, repo = server_module
    _write_json(
        tmp_path / "diagram-types" / "data-flow.json",
        {"id": "data-flow", "title": "Data Flow", "description": "", "style": "boxes-arrows"},
    )
    _write_json(
        diagram_json_path(repo, "custom/data-flow"),
        {"nodes": [], "relations": []},
    )

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/diagrams/status")

    assert response.json()["custom/data-flow"]["ready"] is True
    assert response.json()["custom/data-flow"]["fingerprint"] is not None
