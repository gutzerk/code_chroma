"""TestClient coverage for the live WS endpoint WS /repos/{repo_id}/events on the bridge server."""


import pytest
from fastapi.testclient import TestClient

from tests.conftest import copy_sample_repo


@pytest.fixture
def server_module(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    copy_sample_repo(repo)

    bridge = make_bridge(repo)
    return bridge, repo


def test_broadcast_reaches_a_connected_canvas(server_module):
    bridge, _repo = server_module

    with TestClient(bridge.app) as client:
        with client.websocket_connect("/repos/default/events") as websocket:
            bridge.connections.broadcast_threadsafe({"type": "changed", "paths": ["x.py"]})
            message = websocket.receive_json()

    assert message == {"type": "changed", "paths": ["x.py"]}


def test_repo_change_reanalyzes_and_pings_the_canvas(server_module):
    bridge, repo = server_module

    with TestClient(bridge.app) as client:
        bridge.watcher.stop()
        # Main emits to the "main" key (see Workspace.emit), so listen on that repo id.
        with client.websocket_connect("/repos/main/events") as websocket:
            slugify_path = repo / "shared" / "text_utils.py"
            slugify_path.write_text(
                slugify_path.read_text(encoding="utf-8").replace(
                    'return text.strip().lower().replace(" ", "-")', 'return "patched"'
                )
, encoding="utf-8")
            bridge.main._watchers.on_repo_change()
            message = websocket.receive_json()

    assert message["type"] == "changed"
    assert "shared/text_utils.py" in message["paths"]
