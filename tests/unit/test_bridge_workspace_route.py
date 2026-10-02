"""TestClient coverage for /workspaces/{id}/activate and /status on the bridge server."""

import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from codechroma.bridge.agents import worktree

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


def _init_repo(root: Path) -> None:
    subprocess.run(["git", "init"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)
    subprocess.run(["git", "add", "-A"], cwd=root, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=root, check=True, capture_output=True)


@pytest.fixture
def client(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _init_repo(repo)
    monkeypatch.setenv(worktree.WORKSPACES_DIR_ENV, str(tmp_path / "worktrees"))

    bridge = make_bridge(repo)
    return TestClient(bridge.app), repo, bridge


def test_main_is_ready_without_being_activated(client):
    test_client, _repo, _server = client

    response = test_client.get("/workspaces/main/status")

    assert response.json() == {
        "id": "main", "state": "ready", "progress": "", "error": None, "read_only": False
    }


def test_activating_an_unknown_workspace_is_404(client):
    test_client, _repo, _server = client

    response = test_client.post("/workspaces/nobody/activate")

    assert response.status_code == 404


def test_an_unknown_workspaces_status_is_an_error_not_a_silent_wait(client):
    test_client, _repo, _server = client

    body = test_client.get("/workspaces/nobody/status").json()

    assert body["state"] == "error"
    assert body["error"] == "unknown workspace"


def test_activating_an_agent_records_it_and_brings_its_graph_up(client):
    test_client, _repo, bridge = client
    test_client.post("/agents", json={"title": "refund flow"})

    response = test_client.post("/workspaces/refund-flow/activate")

    assert response.status_code == 200
    assert test_client.get("/agents").json()["active_workspace"] == "refund-flow"
    # get() joins the in-flight bring-up, so by here the graph is real, not a promise.
    assert bridge.registry.get("refund-flow").engine.get_node(
        "shared/text_utils.py::function::slugify"
    ) is not None


def test_an_activated_agents_canvas_reads_its_own_worktree(client):
    test_client, _repo, _server = client
    created = test_client.post("/agents", json={"title": "refund flow"}).json()
    (Path(created["worktree"]) / "brand_new.py").write_text("def brand_new():\n    return 1\n")
    test_client.post("/workspaces/refund-flow/activate")

    children = test_client.get("/repos/refund-flow/nodes/root/children").json()
    main_children = test_client.get("/repos/main/nodes/root/children").json()

    assert "brand_new.py" in {child["name"] for child in children}
    assert "brand_new.py" not in {child["name"] for child in main_children}


def test_the_agents_new_file_is_a_real_block_not_only_a_diff_panel(client):
    test_client, _repo, _server = client
    created = test_client.post("/agents", json={"title": "refund flow"}).json()
    (Path(created["worktree"]) / "brand_new.py").write_text("def brand_new():\n    return 1\n")
    test_client.post("/workspaces/refund-flow/activate")

    node = test_client.get("/repos/refund-flow/nodes/component::brand_new.py").json()

    assert node is not None
    assert node["name"] == "brand_new.py"


def test_activation_is_broadcast_so_other_views_follow(client, monkeypatch):
    test_client, _repo, bridge = client
    test_client.post("/agents", json={"title": "refund flow"})
    sent: list[dict] = []

    async def record(message: dict) -> None:
        sent.append(message)

    monkeypatch.setattr(bridge.connections, "broadcast", record)
    test_client.post("/workspaces/refund-flow/activate")

    assert {"type": "workspace-activated", "id": "refund-flow"} in sent


def test_switching_back_to_main_leaves_the_agent_workspace_loaded(client):
    test_client, _repo, bridge = client
    test_client.post("/agents", json={"title": "refund flow"})
    test_client.post("/workspaces/refund-flow/activate")
    bridge.registry.get("refund-flow")

    test_client.post("/workspaces/main/activate")

    assert test_client.get("/agents").json()["active_workspace"] == "main"
    assert bridge.registry.is_live("refund-flow")
