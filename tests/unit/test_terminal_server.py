"""Unit tests for the terminal WebSocket server: allow-list, echo, resize, and process lifecycle."""

import json
import time

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from codechroma.terminal import server


def test_unknown_agent_is_rejected_without_spawning_a_process(monkeypatch):
    spawned = []
    monkeypatch.setattr(server, "ALLOWED_AGENTS", {})
    monkeypatch.setattr(server, "PtySession", lambda *a, **kw: spawned.append(1))
    client = TestClient(server.app)

    with client.websocket_connect("/ws/terminal?agent=claude") as websocket:
        frame = websocket.receive_text()

    assert frame.startswith(server._ERROR_TAG)
    assert json.loads(frame[1:])["type"] == "error"
    assert not spawned


def test_a_provider_routed_agent_with_no_live_session_fails_rather_than_spawning(monkeypatch):
    """061: a bare `?agent=agent` (no live workspace) must fail cleanly, never Popen([])."""
    spawned = []
    monkeypatch.setattr(server, "PtySession", lambda *a, **kw: spawned.append(1))
    client = TestClient(server.app)

    with client.websocket_connect("/ws/terminal?agent=agent") as websocket:
        frame = websocket.receive_text()

    assert frame.startswith(server._ERROR_TAG)
    assert json.loads(frame[1:])["type"] == "error"
    assert not spawned


def test_input_is_echoed_back_through_the_pty(monkeypatch):
    monkeypatch.setattr(server, "ALLOWED_AGENTS", {"echo-agent": ["cat"]})
    client = TestClient(server.app)

    with client.websocket_connect("/ws/terminal?agent=echo-agent") as websocket:
        websocket.send_text(json.dumps({"type": "input", "data": "hello\n"}))
        received = ""
        deadline = time.monotonic() + 5
        while "hello" not in received and time.monotonic() < deadline:
            received += websocket.receive_text()

    assert "hello" in received


def test_terminal_starts_in_the_configured_repo_path(monkeypatch, tmp_path):
    monkeypatch.setenv("codechroma_BRIDGE_REPO_PATH", str(tmp_path))
    monkeypatch.setattr(server, "ALLOWED_AGENTS", {"pwd-agent": ["sh", "-c", "pwd"]})
    client = TestClient(server.app)

    with client.websocket_connect("/ws/terminal?agent=pwd-agent") as websocket:
        received = ""
        deadline = time.monotonic() + 5
        while str(tmp_path.resolve()) not in received and time.monotonic() < deadline:
            received += websocket.receive_text()

    assert str(tmp_path.resolve()) in received


def test_resize_message_updates_the_pty_session_size(monkeypatch):
    sessions = []
    real_session = server.PtySession

    def spy_session(*args, **kwargs):
        session = real_session(*args, **kwargs)
        sessions.append(session)
        return session

    monkeypatch.setattr(server, "ALLOWED_AGENTS", {"echo-agent": ["cat"]})
    monkeypatch.setattr(server, "PtySession", spy_session)
    client = TestClient(server.app)

    with client.websocket_connect("/ws/terminal?agent=echo-agent") as websocket:
        websocket.send_text(json.dumps({"type": "resize", "rows": 40, "cols": 100}))
        time.sleep(0.2)

    assert sessions[0].last_size == (40, 100)


def test_child_exit_closes_the_websocket(monkeypatch):
    monkeypatch.setattr(server, "ALLOWED_AGENTS", {"quick": ["true"]})
    client = TestClient(server.app)

    with client.websocket_connect("/ws/terminal?agent=quick") as websocket:
        deadline = time.monotonic() + 5
        disconnected = False
        try:
            while time.monotonic() < deadline:
                websocket.receive_text()
        except WebSocketDisconnect:
            disconnected = True

    assert disconnected


def test_malformed_resize_does_not_kill_the_session(monkeypatch):
    monkeypatch.setattr(server, "ALLOWED_AGENTS", {"echo-agent": ["cat"]})
    client = TestClient(server.app)

    with client.websocket_connect("/ws/terminal?agent=echo-agent") as websocket:
        websocket.send_text(json.dumps({"type": "resize", "rows": "oops", "cols": 100}))
        websocket.send_text(json.dumps({"type": "input", "data": "hello\n"}))
        received = ""
        deadline = time.monotonic() + 5
        while "hello" not in received and time.monotonic() < deadline:
            received += websocket.receive_text()

    assert "hello" in received


def test_disconnecting_closes_the_pty_session(monkeypatch):
    closed = []
    real_close = server.PtySession.close

    def spy_close(self):
        closed.append(True)
        real_close(self)

    monkeypatch.setattr(server, "ALLOWED_AGENTS", {"sleepy": ["sleep", "5"]})
    monkeypatch.setattr(server.PtySession, "close", spy_close)
    client = TestClient(server.app)

    with client.websocket_connect("/ws/terminal?agent=sleepy"):
        pass

    assert closed == [True]


def test_allowed_agents_and_cli_dispatch_unaffected_by_skill_agent_cli_refactor(
    tmp_path, monkeypatch
):
    """FR-012/SC-005: skill_agent.py's _run_cli refactor must not alter this allow-list.

    061 adds the provider-routed `agent` kind; its placeholder argv is resolved at launch, never
    executed. The `claude` and `shell` rows stay byte-for-byte what they were, so a legacy record's
    launch is unchanged.
    """
    from codechroma.terminal.agents import ALLOWED_AGENTS, agent_cli

    monkeypatch.setenv("codechroma_ASSISTANT_SETTINGS_FILE", str(tmp_path / "settings.json"))

    assert set(ALLOWED_AGENTS) == {"shell", "claude", "agent"}
    assert ALLOWED_AGENTS["claude"] == ["claude"]
    # The placeholder resolves at launch; it is never executed, and empty is the truthful sentinel.
    assert ALLOWED_AGENTS["agent"] == []
    assert agent_cli("claude")[0][:1] == ["claude"]
    assert "--plugin-dir" in agent_cli("claude")[0]
    assert agent_cli("shell")[0] == ALLOWED_AGENTS["shell"]
