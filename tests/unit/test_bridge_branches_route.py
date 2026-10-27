"""TestClient coverage for /branches: worktree tabs (one worktree + git branch per tab)."""

import shutil
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from codechroma.bridge.agents import worktree
from tests.conftest import git

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"


@pytest.fixture
def client(tmp_path, monkeypatch, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    git(repo, "init", "-b", "main")
    git(repo, "config", "user.email", "test@example.com")
    git(repo, "config", "user.name", "Test")
    git(repo, "add", "-A")
    git(repo, "commit", "-m", "initial")
    git(repo, "branch", "feature-x")
    monkeypatch.setenv(worktree.WORKSPACES_DIR_ENV, str(tmp_path / "worktrees"))
    bridge = make_bridge(repo)
    return TestClient(bridge.app), repo, bridge


def _head(path: str | Path) -> str:
    return git(Path(path), "rev-parse", "HEAD").strip()


def _with_remote(repo: Path, tmp_path: Path) -> Path:
    remote = tmp_path / "remote.git"
    subprocess.run(
        ["git", "init", "--bare", "-b", "main", str(remote)], check=True, capture_output=True
    )
    git(repo, "remote", "add", "origin", str(remote))
    git(repo, "push", "origin", "main")
    return remote


def _create_agent(test_client, workspace: str) -> dict:
    body = {"title": "helper", "kind": "shell", "workspace": workspace}
    return test_client.post("/agents", json=body).json()


def test_ensure_creates_wt_1_off_head_and_leaves_main_untouched(client):
    test_client, repo, bridge = client
    before = _head(repo)

    body = test_client.post("/branches/ensure").json()

    record = body["branches"][0]
    assert record["id"] == "br_wt-1"
    assert record["name"] == record["branch"] == "wt-1"
    assert body["active"] == "br_wt-1"
    assert _head(record["worktree"]) == before
    assert git(repo, "branch", "--show-current").strip() == "main"
    assert bridge.registry.is_registered("br_wt-1")


def test_ensure_with_existing_records_creates_nothing(client):
    test_client, _repo, _bridge = client
    test_client.post("/branches/ensure")

    body = test_client.post("/branches/ensure").json()

    assert [b["id"] for b in body["branches"]] == ["br_wt-1"]


def test_new_twice_numbers_the_tabs_and_activates_the_newest(client):
    test_client, _repo, _bridge = client

    first = test_client.post("/branches/new", json={}).json()
    second = test_client.post("/branches/new").json()

    assert (first["branch"]["id"], second["branch"]["id"]) == ("br_wt-1", "br_wt-2")
    assert second["fetched"] is False
    assert second["warning"] == "no remote 'origin'; branched from the local default branch"
    assert test_client.get("/branches").json()["active"] == "br_wt-2"


def test_new_skips_a_wt_n_branch_that_already_exists(client):
    test_client, repo, _bridge = client
    git(repo, "branch", "wt-1")

    body = test_client.post("/branches/new").json()

    assert body["branch"]["branch"] == "wt-2"


def test_new_with_a_name_uses_it_and_refuses_taken_or_invalid_names(client):
    test_client, _repo, _bridge = client

    ok = test_client.post("/branches/new", json={"name": "my-task"})
    taken = test_client.post("/branches/new", json={"name": "feature-x"})
    bad = test_client.post("/branches/new", json={"name": "bad name"})

    assert ok.json()["branch"]["branch"] == "my-task"
    assert (taken.status_code, bad.status_code) == (409, 409)


def test_new_does_not_track_the_start_point(client, tmp_path):
    test_client, repo, _bridge = client
    _with_remote(repo, tmp_path)

    record = test_client.post("/branches/new").json()["branch"]

    tracked = subprocess.run(
        ["git", "config", "--get", f"branch.{record['branch']}.remote"],
        cwd=repo, capture_output=True, text=True,
    )
    assert tracked.stdout.strip() == ""


def test_new_branches_off_the_fetched_origin_main_when_a_remote_exists(client, tmp_path):
    test_client, repo, _bridge = client
    remote = _with_remote(repo, tmp_path)
    other = tmp_path / "other"
    subprocess.run(["git", "clone", str(remote), str(other)], check=True, capture_output=True)
    git(other, "config", "user.email", "t@example.com")
    git(other, "config", "user.name", "T")
    (other / "newer.txt").write_text("x", encoding="utf-8")
    git(other, "add", "-A")
    git(other, "commit", "-m", "newer")
    git(other, "push", "origin", "main")

    body = test_client.post("/branches/new").json()

    assert body["fetched"] is True
    assert (Path(body["branch"]["worktree"]) / "newer.txt").is_file()
    assert not (repo / "newer.txt").exists()


def test_a_failing_fetch_falls_back_to_local_main_with_a_warning(client):
    test_client, repo, _bridge = client
    git(repo, "remote", "add", "origin", str(repo.parent / "does-not-exist.git"))

    body = test_client.post("/branches/new").json()

    assert body["fetched"] is False
    assert "could not fetch" in body["warning"]
    assert (Path(body["branch"]["worktree"]) / "shared" / "text_utils.py").is_file()


def test_rename_moves_the_branch_but_not_the_id_or_path(client):
    test_client, repo, _bridge = client
    created = test_client.post("/branches/new").json()["branch"]

    response = test_client.patch(f"/branches/{created['id']}", json={"name": "feature/login"})

    body = response.json()
    assert response.status_code == 200
    assert (body["id"], body["worktree"]) == (created["id"], created["worktree"])
    assert body["name"] == body["branch"] == "feature/login"
    branches = git(repo, "branch", "--format=%(refname:short)").split()
    assert "feature/login" in branches
    assert "wt-1" not in branches


def test_rename_to_a_taken_name_is_a_409(client):
    test_client, _repo, _bridge = client
    first = test_client.post("/branches/new").json()["branch"]
    second = test_client.post("/branches/new").json()["branch"]

    held = test_client.patch(f"/branches/{second['id']}", json={"name": first["branch"]})
    existing = test_client.patch(f"/branches/{second['id']}", json={"name": "feature-x"})

    assert (held.status_code, existing.status_code) == (409, 409)


def test_rename_validates_its_input(client):
    test_client, _repo, _bridge = client
    created = test_client.post("/branches/new").json()["branch"]

    empty = test_client.patch(f"/branches/{created['id']}", json={"name": " "})
    unknown = test_client.patch("/branches/br_nope", json={"name": "x"})

    assert (empty.status_code, unknown.status_code) == (400, 404)


def test_renaming_a_tab_moves_its_agents_branch(client):
    test_client, _repo, _bridge = client
    created = test_client.post("/branches/new").json()["branch"]
    agent = _create_agent(test_client, created["id"])

    test_client.patch(f"/branches/{created['id']}", json={"name": "renamed"})

    listed = test_client.get("/agents").json()["agents"]
    assert [(a["id"], a["branch"]) for a in listed] == [(agent["id"], "renamed")]


def test_list_reports_the_dirty_count_per_tab(client):
    test_client, _repo, _bridge = client
    created = test_client.post("/branches/new").json()["branch"]
    (Path(created["worktree"]) / "a.txt").write_text("a", encoding="utf-8")
    (Path(created["worktree"]) / "b.txt").write_text("b", encoding="utf-8")

    listed = test_client.get("/branches").json()["branches"]

    assert listed[0]["dirty"] == 2


def test_active_tab_is_persisted_across_a_restart(client, make_bridge):
    test_client, repo, _bridge = client
    test_client.post("/branches/new")
    test_client.post("/branches/new")
    test_client.put("/branches/active", json={"id": "br_wt-1"})

    restarted = make_bridge(repo)

    body = TestClient(restarted.app).get("/branches").json()
    assert body["active"] == "br_wt-1"
    assert restarted.registry.is_registered("br_wt-2")


def test_activating_an_unknown_tab_is_a_404_and_a_missing_id_a_400(client):
    test_client, _repo, _bridge = client

    unknown = test_client.put("/branches/active", json={"id": "br_nope"})
    missing = test_client.put("/branches/active", json={})

    assert (unknown.status_code, missing.status_code) == (404, 400)


def test_a_tab_whose_directory_vanished_is_listed_but_not_registered(client, make_bridge):
    test_client, repo, _bridge = client
    created = test_client.post("/branches/new").json()["branch"]
    shutil.rmtree(created["worktree"])

    restarted = make_bridge(repo)

    assert not restarted.registry.is_registered(created["id"])
    assert restarted.services.branch_manager.get(created["id"]).worktree_lost is True


def test_closing_a_tab_keeps_the_directory_and_the_branch(client):
    test_client, repo, bridge = client
    created = test_client.post("/branches/new").json()["branch"]

    response = test_client.delete(f"/branches/{created['id']}")

    assert response.status_code == 200
    assert Path(created["worktree"]).is_dir()
    assert not bridge.registry.is_registered(created["id"])
    assert "wt-1" in git(repo, "branch")


def test_closing_with_worktree_too_removes_even_a_dirty_directory(client):
    test_client, _repo, _bridge = client
    created = test_client.post("/branches/new").json()["branch"]
    (Path(created["worktree"]) / "untracked.txt").write_text("dirty", encoding="utf-8")

    response = test_client.delete(f"/branches/{created['id']}", params={"worktree_too": "true"})

    assert response.status_code == 200
    assert not Path(created["worktree"]).exists()


def test_closing_a_tab_removes_the_agents_on_it(client):
    test_client, _repo, bridge = client
    created = test_client.post("/branches/new").json()["branch"]
    agent = _create_agent(test_client, created["id"])

    test_client.delete(f"/branches/{created['id']}", params={"worktree_too": "true"})

    assert test_client.get("/agents").json()["agents"] == []
    assert not bridge.registry.is_registered(agent["id"])


def test_deleting_the_active_tab_clears_the_active_id_for_the_client_to_pick(client):
    test_client, _repo, _bridge = client
    test_client.post("/branches/new")
    test_client.post("/branches/new")

    test_client.delete("/branches/br_wt-2", params={"worktree_too": "true"})

    listing = test_client.get("/branches").json()
    assert listing["active"] is None
    assert [b["id"] for b in listing["branches"]] == ["br_wt-1"]


def test_closing_with_keep_leaves_the_record_so_the_tab_returns(client):
    test_client, _repo, _bridge = client
    created = test_client.post("/branches/new").json()["branch"]

    test_client.delete(f"/branches/{created['id']}")

    assert [b["id"] for b in test_client.get("/branches").json()["branches"]] == [created["id"]]


def test_closing_an_unknown_tab_is_a_404(client):
    test_client, _repo, _bridge = client

    assert test_client.delete("/branches/br_nobody").status_code == 404


def test_a_tab_can_be_activated_as_a_canvas_workspace(client):
    test_client, _repo, _bridge = client
    created = test_client.post("/branches/new").json()["branch"]

    response = test_client.post(f"/workspaces/{created['id']}/activate")

    assert response.status_code == 200


def test_the_open_existing_branch_mode_and_choices_endpoint_are_gone(client):
    test_client, _repo, _bridge = client

    choices = test_client.get("/branches/choices")
    opened = test_client.post("/branches", json={"branch": "feature-x"})

    assert choices.status_code in (404, 405)
    assert opened.status_code in (404, 405)


def test_a_failure_after_the_checkout_leaves_no_worktree_or_branch_behind(client, monkeypatch):
    test_client, repo, _bridge = client

    def boom(*_args):
        raise RuntimeError("skills could not be installed")

    monkeypatch.setattr("codechroma.bridge.branches.manager.skill_sync.install_into_worktree", boom)
    with pytest.raises(RuntimeError):
        test_client.post("/branches/new")
    monkeypatch.undo()

    assert "wt-1" not in git(repo, "branch")
    assert test_client.get("/branches").json()["branches"] == []
    assert test_client.post("/branches/new").status_code == 200


def test_closing_a_tab_tells_the_other_windows(client, monkeypatch):
    test_client, _repo, bridge = client
    created = test_client.post("/branches/new").json()["branch"]
    sent = []

    async def capture(message):
        sent.append(message)

    monkeypatch.setattr(bridge.services.connections, "broadcast", capture)

    test_client.delete(f"/branches/{created['id']}")

    assert sent == [{"type": "branch-removed", "id": created["id"]}]
