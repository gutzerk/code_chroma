"""TestClient coverage: the PTY terminal route is mounted on the graph bridge server itself."""

import json
import time

import pytest
from fastapi.testclient import TestClient

from codechroma.terminal import server as terminal_server
from tests.conftest import copy_sample_repo
from tests.unit.portable_commands import ECHO


@pytest.fixture
def bridge_server(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    copy_sample_repo(repo)

    bridge = make_bridge(repo)
    return bridge


def test_terminal_route_echoes_through_the_bridge(bridge_server, monkeypatch):
    monkeypatch.setattr(terminal_server, "ALLOWED_AGENTS", {"echo-agent": ECHO})

    with TestClient(bridge_server.app) as client:
        with client.websocket_connect("/ws/terminal?agent=echo-agent") as websocket:
            websocket.send_text(json.dumps({"type": "input", "data": "hello\n"}))
            received = ""
            deadline = time.monotonic() + 5
            while "hello" not in received and time.monotonic() < deadline:
                received += websocket.receive_text()

    assert "hello" in received
