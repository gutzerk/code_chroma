"""TestClient coverage for GET /repos/{id}/traces[/{id}] and the trace-dir "trace" broadcast."""

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


def _write_trace(repo: Path, trace_id: str, steps: list[dict], status: str = "ok") -> None:
    traces_dir = repo / ".codechroma" / "traces"
    traces_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "id": trace_id,
        "entry": "scenario.main()",
        "created_at": "2026-07-20T00:00:00+00:00",
        "status": status,
        "steps": steps,
    }
    (traces_dir / f"{trace_id}.json").write_text(json.dumps(payload))


@pytest.fixture
def server_module(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)

    bridge = make_bridge(repo)
    return bridge, repo


def test_list_traces_returns_summaries(server_module):
    bridge, repo = server_module
    _write_trace(repo, "abc123", [{"seq": 0, "node_id": "n", "event": "call", "depth": 0}])

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/traces")

    body = response.json()
    assert response.status_code == 200
    assert body[0]["id"] == "abc123"
    assert body[0]["step_count"] == 1
    assert body[0]["status"] == "ok"


def test_get_trace_returns_steps_ordered_by_seq(server_module):
    bridge, repo = server_module
    steps = [
        {"seq": 2, "node_id": "c", "event": "return", "depth": 0},
        {"seq": 0, "node_id": "a", "event": "call", "depth": 0},
        {"seq": 1, "node_id": "b", "event": "call", "depth": 1},
    ]
    _write_trace(repo, "ordered", steps)

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/traces/ordered")

    body = response.json()
    assert [s["seq"] for s in body["steps"]] == [0, 1, 2]


def test_missing_trace_yields_empty_dict(server_module):
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/traces/nope")

    assert response.json() == {}


def test_trace_change_pings_the_canvas(server_module):
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        bridge.trace_watcher.stop()
        with client.websocket_connect("/repos/main/events") as websocket:
            bridge.main._watchers.on_trace_change()
            message = websocket.receive_json()

    assert message == {"type": "trace"}


def test_trace_ingest_relays_steps_to_stream_consumers(server_module):
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        with client.websocket_connect("/repos/default/trace-stream") as consumer:
            with client.websocket_connect("/repos/default/trace-ingest") as producer:
                producer.send_json({"type": "step", "step": {"seq": 0, "node_id": "a"}})
                message = consumer.receive_json()

    assert message == {"type": "step", "step": {"seq": 0, "node_id": "a"}}
