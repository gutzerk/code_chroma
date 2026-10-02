"""Unit tests for the live bridge plumbing: ConnectionManager fan-out and RepoWatcher callbacks."""

import asyncio
import threading

from codechroma.bridge.live import ConnectionManager, FileWatcher, RepoWatcher


class FakeWebSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)


def test_broadcast_delivers_to_every_connection():
    manager = ConnectionManager()
    first, second = FakeWebSocket(), FakeWebSocket()
    manager._connections = {first: None, second: None}

    asyncio.run(manager._broadcast({"type": "changed"}))

    assert first.sent == [{"type": "changed"}]
    assert second.sent == [{"type": "changed"}]


def test_keyed_broadcast_only_reaches_connections_registered_under_that_key():
    manager = ConnectionManager()
    main, agent = FakeWebSocket(), FakeWebSocket()
    manager._connections = {main: "main", agent: "agent-1"}

    asyncio.run(manager._broadcast({"type": "step"}, "agent-1"))

    assert main.sent == []
    assert agent.sent == [{"type": "step"}]


def test_broadcast_still_reaches_healthy_sockets_when_one_fails_and_drops_the_failed_one():
    manager = ConnectionManager()

    class BrokenWebSocket:
        async def send_json(self, _message: dict) -> None:
            raise RuntimeError("half-open socket")

    broken, healthy = BrokenWebSocket(), FakeWebSocket()
    manager._connections = {broken: None, healthy: None}

    asyncio.run(manager._broadcast({"type": "changed"}))

    assert healthy.sent == [{"type": "changed"}]
    assert broken not in manager._connections


def test_broadcast_threadsafe_is_a_noop_before_a_loop_is_bound():
    manager = ConnectionManager()

    manager.broadcast_threadsafe({"type": "changed"})

    assert manager._loop is None


def test_watcher_fires_callback_when_a_file_changes(tmp_path):
    (tmp_path / "a.py").write_text("x = 1\n")
    fired = threading.Event()
    watcher = RepoWatcher(tmp_path, fired.set, debounce_ms=200)
    watcher.start()
    try:
        (tmp_path / "a.py").write_text("x = 2\n")
        assert fired.wait(timeout=10)
    finally:
        watcher.stop()


def test_file_watcher_fires_on_a_watched_file_under_codechroma(tmp_path):
    watched_path = tmp_path / ".codechroma" / "example.json"
    watched_path.parent.mkdir(parents=True)
    fired = threading.Event()
    watcher = FileWatcher(watched_path, fired.set, debounce_ms=200)
    watcher.start()
    try:
        watched_path.write_text('{"steps": []}')
        assert fired.wait(timeout=10)
    finally:
        watcher.stop()


def test_file_watcher_ignores_sibling_files(tmp_path):
    watched_path = tmp_path / ".codechroma" / "example.json"
    watched_path.parent.mkdir(parents=True)
    fired = threading.Event()
    watcher = FileWatcher(watched_path, fired.set, debounce_ms=200)
    watcher.start()
    try:
        (tmp_path / ".codechroma" / "graph.db").write_text("noise")
        assert not fired.wait(timeout=2)
    finally:
        watcher.stop()
