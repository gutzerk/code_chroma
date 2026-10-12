"""TestClient coverage for /branches: reopening a project on another branch in its own worktree."""

import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from codechroma.bridge.agents import worktree

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


def _git(root: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)


@pytest.fixture
def client(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _git(repo, "init", "-b", "main")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "initial")
    _git(repo, "branch", "feature-x")
    monkeypatch.setenv(worktree.WORKSPACES_DIR_ENV, str(tmp_path / "worktrees"))
    bridge = make_bridge(repo)
    return TestClient(bridge.app), repo, bridge


def _choices(test_client) -> dict:
    return {b["name"]: b for b in test_client.get("/branches/choices").json()["branches"]}


def test_the_checked_out_branch_is_reported_as_open_in_main(client):
    test_client, _repo, _bridge = client

    choices = _choices(test_client)

    assert choices["main"]["workspace"] == "main"
    assert choices["feature-x"] == {"name": "feature-x", "open": False, "workspace": None}


def test_opening_an_existing_branch_gives_it_its_own_worktree_and_graph(client):
    test_client, repo, bridge = client

    response = test_client.post("/branches", json={"branch": "feature-x"})

    record = response.json()
    assert response.status_code == 200
    assert record["id"] == "br_feature-x"
    assert Path(record["worktree"]).is_dir()
    assert Path(record["worktree"]).resolve() != repo.resolve()
    assert bridge.registry.is_registered(record["id"])
    assert test_client.get("/repos/br_feature-x/nodes/root/children").status_code == 200


def test_an_opened_branch_is_then_reported_as_held_by_its_workspace(client):
    test_client, _repo, _bridge = client
    test_client.post("/branches", json={"branch": "feature-x"})

    choices = _choices(test_client)

    assert choices["feature-x"]["workspace"] == "br_feature-x"


def test_opening_a_branch_that_is_already_open_names_the_holder(client):
    test_client, _repo, _bridge = client
    test_client.post("/branches", json={"branch": "feature-x"})

    response = test_client.post("/branches", json={"branch": "feature-x"})

    assert response.status_code == 409
    assert response.json()["detail"]["workspace"] == "br_feature-x"


def test_opening_the_branch_main_has_checked_out_is_refused_as_held_by_main(client):
    test_client, _repo, _bridge = client

    response = test_client.post("/branches", json={"branch": "main"})

    assert response.status_code == 409
    assert response.json()["detail"]["workspace"] == "main"


def test_creating_a_new_branch_forks_it_from_the_current_one(client):
    test_client, repo, _bridge = client

    response = test_client.post("/branches", json={"new_branch": "my-task"})

    record = response.json()
    assert response.status_code == 200
    head = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=record["worktree"], capture_output=True, text=True, check=True,
    ).stdout.strip()
    assert head == "my-task"
    assert (repo / "shared" / "text_utils.py").is_file()


@pytest.mark.parametrize("name", ["bad name", "-rf", "a..b", ""])
def test_an_invalid_new_branch_name_is_refused(client, name):
    test_client, _repo, _bridge = client

    response = test_client.post("/branches", json={"new_branch": name})

    assert response.status_code == 409


def test_creating_a_branch_that_already_exists_is_refused(client):
    test_client, _repo, _bridge = client

    response = test_client.post("/branches", json={"new_branch": "feature-x"})

    assert response.status_code == 409


def test_sending_both_or_neither_of_branch_and_new_branch_is_a_400(client):
    test_client, _repo, _bridge = client

    both = test_client.post("/branches", json={"branch": "a", "new_branch": "b"})
    neither = test_client.post("/branches", json={})

    assert (both.status_code, neither.status_code) == (400, 400)


def test_an_unknown_branch_is_a_404(client):
    test_client, _repo, _bridge = client

    response = test_client.post("/branches", json={"branch": "nope"})

    assert response.status_code == 404


def test_branch_workspaces_survive_a_restart(client, make_bridge):
    test_client, repo, _bridge = client
    created = test_client.post("/branches", json={"branch": "feature-x"}).json()

    restarted = make_bridge(repo)

    assert restarted.registry.is_registered(created["id"])
    assert [b["id"] for b in TestClient(restarted.app).get("/branches").json()["branches"]] == [
        created["id"]
    ]


def test_closing_a_branch_workspace_keeps_the_directory_and_the_branch(client):
    test_client, repo, bridge = client
    created = test_client.post("/branches", json={"branch": "feature-x"}).json()

    response = test_client.delete(f"/branches/{created['id']}")

    assert response.status_code == 200
    assert Path(created["worktree"]).is_dir()
    assert not bridge.registry.is_registered(created["id"])
    assert "feature-x" in subprocess.run(
        ["git", "branch"], cwd=repo, capture_output=True, text=True, check=True
    ).stdout


def test_closing_with_worktree_too_removes_the_directory(client):
    test_client, _repo, _bridge = client
    created = test_client.post("/branches", json={"branch": "feature-x"}).json()

    test_client.delete(f"/branches/{created['id']}", params={"worktree_too": "true"})

    assert not Path(created["worktree"]).exists()


def test_closing_an_unknown_branch_workspace_is_a_404(client):
    test_client, _repo, _bridge = client

    assert test_client.delete("/branches/br_nobody").status_code == 404


def test_a_branch_workspace_can_be_activated(client):
    test_client, _repo, _bridge = client
    created = test_client.post("/branches", json={"branch": "feature-x"}).json()

    response = test_client.post(f"/workspaces/{created['id']}/activate")

    assert response.status_code == 200


def test_a_dash_prefixed_start_point_is_refused_not_passed_to_git(client):
    test_client, _repo, _bridge = client

    response = test_client.post("/branches", json={"new_branch": "x", "start_point": "--orphan"})

    assert response.status_code == 404


def test_a_new_branch_can_start_from_another_local_branch(client):
    test_client, _repo, _bridge = client

    response = test_client.post("/branches", json={"new_branch": "x", "start_point": "feature-x"})

    assert response.status_code == 200


def test_a_failure_after_the_checkout_leaves_no_worktree_or_branch_behind(client, monkeypatch):
    test_client, repo, _bridge = client

    def boom(*_args):
        raise RuntimeError("skills could not be installed")

    monkeypatch.setattr("codechroma.bridge.branches.manager.skill_sync.install_into_worktree", boom)
    with pytest.raises(RuntimeError):
        test_client.post("/branches", json={"new_branch": "doomed"})
    monkeypatch.undo()

    branches = subprocess.run(
        ["git", "branch"], cwd=repo, capture_output=True, text=True, check=True
    ).stdout
    assert "doomed" not in branches
    assert test_client.get("/branches").json()["branches"] == []
    assert test_client.post("/branches", json={"new_branch": "doomed"}).status_code == 200
