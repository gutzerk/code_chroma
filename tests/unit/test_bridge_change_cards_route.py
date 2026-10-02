"""TestClient coverage for GET /repos/{repo_id}/change-cards and the read-only write guards."""

import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from codechroma.bridge import skill_agent

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
    monkeypatch.setenv("codechroma_WORKSPACES_DIR", str(tmp_path / "worktrees"))

    bridge = make_bridge(repo)
    return TestClient(bridge.app), repo, bridge


def _edit_slugify(repo: Path) -> None:
    path = repo / "shared" / "text_utils.py"
    path.write_text(path.read_text().replace('" ", "-"', '" ", "_"'))


def test_no_changes_gives_an_empty_but_resolved_payload(client):
    test_client, _repo, _server = client

    body = test_client.get("/repos/default/change-cards").json()

    assert body["cards"] == []
    assert body["card_count"] == 0
    assert body["base_resolved"]


def test_an_edited_function_comes_back_as_a_card_on_its_own_node(client):
    test_client, repo, _server = client
    _edit_slugify(repo)

    body = test_client.get("/repos/default/change-cards").json()

    node_ids = [card["node_id"] for card in body["cards"]]
    assert "shared/text_utils.py::function::slugify" in node_ids
    assert body["by_node"]["shared/text_utils.py::function::slugify"] == 1


def test_an_edited_function_reports_a_modified_block_status(client):
    test_client, repo, _server = client
    _edit_slugify(repo)

    body = test_client.get("/repos/default/change-cards").json()

    node_id = "shared/text_utils.py::function::slugify"
    assert body["by_node_status"][node_id] == "modified"


def test_a_read_only_workspace_refuses_to_accept_a_diff(client):
    test_client, repo, bridge = client
    _edit_slugify(repo)
    bridge.registry.register("pr-12", repo, read_only=True)
    before = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True
    ).stdout

    response = test_client.post(
        "/repos/pr-12/diff/shared%2Ftext_utils.py::function::slugify/accept"
    )

    after = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, text=True
    ).stdout
    assert response.status_code == 409
    assert after == before


@pytest.mark.parametrize(
    "generate_path", ["/repos/pr-12/c1/generate", "/repos/pr-12/impact-changes/generate"]
)
def test_a_read_only_workspace_is_still_allowed_to_start_a_generate_run(
    client, monkeypatch, generate_path
):
    # Generation only writes a .codechroma/{kind}.json artifact, so it stays allowed read-only.
    test_client, repo, bridge = client
    monkeypatch.setattr(skill_agent.shutil, "which", lambda _name: None)
    bridge.registry.register("pr-12", repo, read_only=True)

    response = test_client.post(generate_path)

    assert response.status_code == 200
    assert response.json() == {"state": "error", "error": "claude CLI not found on PATH"}


def test_a_writable_workspace_is_still_allowed_to_accept(client):
    test_client, repo, bridge = client
    _edit_slugify(repo)

    response = test_client.post(
        "/repos/main/diff/shared%2Ftext_utils.py::function::slugify/accept"
    )

    assert response.status_code == 200
    assert not bridge.registry.is_read_only("main")


def test_workspace_status_reports_whether_writes_are_refused(client, tmp_path):
    test_client, repo, bridge = client
    bridge.registry.register("pr-12", repo, read_only=True)
    bridge.registry.register("refund-flow", tmp_path / "agent")

    statuses = {
        name: test_client.get(f"/workspaces/{name}/status").json()
        for name in ("main", "pr-12", "refund-flow")
    }

    assert statuses["pr-12"]["read_only"]
    assert not statuses["main"]["read_only"]
    assert not statuses["refund-flow"]["read_only"]


def test_a_registered_workspace_roots_its_terminal_in_its_own_directory(client, tmp_path):
    _test_client, _repo, bridge = client
    elsewhere = tmp_path / "pr-12-worktree"
    bridge.registry.register("pr-12", elsewhere, read_only=True)

    assert bridge.workspace_cwd("pr-12") == str(elsewhere)
    assert bridge.workspace_cwd("nobody-registered-this") is None
