"""TestClient coverage: the PTY terminal route is mounted on the graph bridge server itself."""

import json
import shutil
import subprocess
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from codechroma.terminal import server as terminal_server

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)


@pytest.fixture
def bridge_server(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)

    bridge = make_bridge(repo)
    return bridge


def test_terminal_route_echoes_through_the_bridge(bridge_server, monkeypatch):
    monkeypatch.setattr(terminal_server, "ALLOWED_AGENTS", {"echo-agent": ["cat"]})

    with TestClient(bridge_server.app) as client:
        with client.websocket_connect("/ws/terminal?agent=echo-agent") as websocket:
            websocket.send_text(json.dumps({"type": "input", "data": "hello\n"}))
            received = ""
            deadline = time.monotonic() + 5
            while "hello" not in received and time.monotonic() < deadline:
                received += websocket.receive_text()

    assert "hello" in received
