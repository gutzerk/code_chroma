"""TestClient coverage for GET/PATCH /repos/{id}/canvas and the "canvas" WS ping."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from codechroma.canvas.document import ensure_seeded


def test_get_canvas_on_a_fresh_repo_already_holds_the_seeded_root_block(bridge):
    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/canvas")

    elements = list(response.json()["elements"].values())
    assert response.status_code == 200
    assert [(e["id"], e["render"], e["node_id"]) for e in elements] == [
        ("seed-hierarchy", "hierarchy", "root")
    ]


def test_the_seeded_root_block_is_real_on_disk_not_synthesized_per_request(bridge):
    with TestClient(bridge.app) as client:
        client.get("/repos/default/canvas")

    saved = json.loads((bridge.repo / ".codechroma" / "canvas-core.json").read_text())
    assert "seed-hierarchy" in saved["elements"]


def test_a_read_only_workspace_serves_the_seed_the_pr_import_wrote(bridge):
    ensure_seeded(
        bridge.repo / ".codechroma" / "canvas-core.json",
        bridge.repo / ".codechroma" / "diagrams",
        "root",
    )
    bridge.registry.register("pr-12", bridge.repo, read_only=True)

    with TestClient(bridge.app) as client:
        response = client.get("/repos/pr-12/canvas")

    elements = list(response.json()["elements"].values())
    assert [e["id"] for e in elements] == ["seed-hierarchy"]


def test_patch_canvas_adds_an_element_and_reports_its_real_id(bridge):
    batch = {"ops": [{"op": "add_element", "temp_id": "t1", "render": "note", "label": "hi"}]}

    with TestClient(bridge.app) as client:
        response = client.patch("/repos/default/canvas", json=batch)

    body = response.json()
    assert response.status_code == 200
    assert body["ok"] is True
    real_id = body["id_map"]["t1"]
    with TestClient(bridge.app) as client:
        follow_up = client.get("/repos/default/canvas")
    assert follow_up.json()["elements"][real_id]["label"] == "hi"


def test_patch_canvas_rejects_an_unknown_target_without_writing_anything(bridge):
    batch = {"ops": [{"op": "delete_element", "id": "missing"}]}

    with TestClient(bridge.app) as client:
        response = client.patch("/repos/default/canvas", json=batch)

    body = response.json()
    assert response.status_code == 200
    assert body["ok"] is False
    assert body["errors"][0]["code"] == "unknown_target"


def test_patch_canvas_reports_failure_when_the_disk_write_does_not_land(bridge, monkeypatch):
    """A drag must never look saved when write_json silently swallowed an OSError underneath it."""
    monkeypatch.setattr("codechroma.canvas.document.write_json", lambda path, payload: False)
    batch = {"ops": [{"op": "add_note", "temp_id": "t1", "label": "note"}]}

    with TestClient(bridge.app) as client:
        response = client.patch("/repos/default/canvas", json=batch)

    body = response.json()
    assert response.status_code == 200
    assert body["ok"] is False
    assert body["errors"][0]["code"] == "write_failed"


def test_patch_canvas_pings_connected_canvases(bridge):
    batch = {"ops": [{"op": "add_note", "temp_id": "t1", "label": "note"}]}

    with TestClient(bridge.app) as client:
        bridge.main._watchers.canvas_core_watcher.stop()
        for watcher in bridge.main._watchers.diagram_projection_watchers.values():
            watcher.stop()
        with client.websocket_connect("/repos/main/events") as websocket:
            response = client.patch("/repos/main/canvas", json=batch)
            message = websocket.receive_json()

    assert response.json()["ok"] is True
    assert message["type"] == "canvas"
    assert message["batch_id"] == response.json()["batch_id"]
