"""TestClient coverage for GET/PATCH /repos/{id}/canvas and the "canvas" WS ping."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_get_canvas_on_a_fresh_repo_is_empty(bridge):
    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/canvas")

    assert response.status_code == 200
    assert response.json()["elements"] == {}


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
