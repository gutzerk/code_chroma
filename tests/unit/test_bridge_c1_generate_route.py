"""TestClient coverage for the background C1 generation routes and their status broadcast."""


import asyncio
import shutil
import subprocess
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.conftest import diagram_json_path
from tests.unit.fake_claude import CLI_MISSING, fake_claude_exec

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

    yield make_bridge(repo), repo


def test_status_defaults_to_idle(server_module):
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        response = client.get("/repos/default/c1/status")

    assert response.status_code == 200
    assert response.json() == {"state": "idle", "error": None}


def test_generate_without_claude_binary_reports_error(server_module, monkeypatch):
    bridge, _repo = server_module
    monkeypatch.setattr("codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: None)

    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/c1/generate")
        status_response = client.get("/repos/default/c1/status")

    assert response.status_code == 200
    assert response.json() == {"state": "error", "error": CLI_MISSING}
    assert status_response.json() == {"state": "error", "error": CLI_MISSING}


def test_only_if_missing_does_not_start_a_run_when_a_diagram_exists(server_module, monkeypatch):
    bridge, repo = server_module
    # Without the guard this reports CLI_MISSING, so idle means it never tried.
    monkeypatch.setattr("codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: None)
    c1_path = diagram_json_path(repo, "c1")
    c1_path.parent.mkdir(parents=True, exist_ok=True)
    c1_path.write_text('{"system": {"name": "Sample"}, "actors": []}')

    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/c1/generate?only_if_missing=true")

    assert response.json() == {"state": "idle", "error": None}


def test_only_if_missing_still_starts_a_run_when_the_existing_diagram_is_a_draft(
    server_module, monkeypatch
):
    bridge, repo = server_module
    monkeypatch.setattr("codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: None)
    # 043: bring-up's draft c1.json must not count as "already generated" for only_if_missing.

    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/c1/generate?only_if_missing=true")

    assert response.json() == {"state": "error", "error": CLI_MISSING}


def test_only_if_missing_still_starts_a_run_when_no_diagram_exists(server_module, monkeypatch):
    bridge, repo = server_module
    monkeypatch.setattr("codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: None)
    # 043: undo bring-up's deterministic bootstrap so this test starts from a truly-missing file.
    diagram_json_path(repo, "c1").unlink(missing_ok=True)

    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/c1/generate?only_if_missing=true")

    assert not diagram_json_path(repo, "c1").exists()
    assert response.json() == {"state": "error", "error": CLI_MISSING}


def test_cancel_without_a_run_resets_to_idle(server_module, monkeypatch):
    bridge, _repo = server_module
    monkeypatch.setattr("codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: None)

    with TestClient(bridge.app) as client:
        response = client.post("/repos/default/c1/cancel")

    assert response.status_code == 200
    assert response.json() == {"state": "idle", "error": None}


def test_cancel_kills_an_in_flight_run_and_reports_idle(server_module, monkeypatch):
    bridge, _repo = server_module
    monkeypatch.setattr(
        "codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: "/usr/bin/claude"
    )
    killed = []
    monkeypatch.setattr(
        asyncio, "create_subprocess_exec", fake_claude_exec(hang=True, killed=killed)
    )

    with TestClient(bridge.app) as client:
        started = client.post("/repos/default/c1/generate")
        assert started.json()["state"] == "generating"
        # Let the background task reach its subprocess spawn before cancelling.
        time.sleep(0.1)
        cancelled = client.post("/repos/default/c1/cancel")
        status = client.get("/repos/default/c1/status")

    assert cancelled.json() == {"state": "idle", "error": None}
    assert status.json() == {"state": "idle", "error": None}
    assert killed == [True]


def test_generate_broadcasts_status_over_events_socket(server_module, monkeypatch):
    bridge, _repo = server_module
    monkeypatch.setattr("codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: None)

    with TestClient(bridge.app) as client:
        with client.websocket_connect("/repos/default/events") as websocket:
            client.post("/repos/default/c1/generate")
            message = websocket.receive_json()

    assert message == {
        "type": "c1-status",
        "state": "error",
        "error": CLI_MISSING,
    }


def _receive_until(websocket, message_type: str, attempts: int = 10) -> dict:
    """Reads frames until `message_type` arrives, skipping unrelated pings that can race it."""
    for _ in range(attempts):
        message = websocket.receive_json()
        if message.get("type") == message_type:
            return message
    raise AssertionError(f"no {message_type!r} message within {attempts} frames")


def test_generate_broadcasts_tag_the_ping_with_the_agents_workspace_id(server_module, monkeypatch):
    bridge, _repo = server_module
    monkeypatch.setattr("codechroma.llm.runtime_env.shutil.which", lambda _name, **_kwargs: None)

    with TestClient(bridge.app) as client:
        agent_id = client.post("/agents", json={"title": "refund flow"}).json()["id"]
        with client.websocket_connect(f"/repos/{agent_id}/events") as websocket:
            client.post(f"/repos/{agent_id}/c1/generate")
            message = _receive_until(websocket, "c1-status")

    assert message == {
        "type": "c1-status",
        "state": "error",
        "error": CLI_MISSING,
        "workspace": agent_id,
    }
