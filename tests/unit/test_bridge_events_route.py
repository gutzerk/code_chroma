"""TestClient coverage for the live WS endpoint WS /repos/{repo_id}/events on the bridge server."""

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


@pytest.fixture
def server_module(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)

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
