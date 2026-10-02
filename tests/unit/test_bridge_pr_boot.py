"""A fetched pull request survives a bridge restart: re-registered, read-only, still the active one.

🔴 Without the boot loop, `registry.get("pr-12")` silently returns *main* and the canvas draws the
main repository's graph under the pull request's name.

A "restart" is now a second `create_app` over the same repository -- which is what the boot loop
actually has to survive, and no longer needs a module reload to express.
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "sample_repo"

PR_ENTRY = {
    "number": 12,
    "title": "Add refunds",
    "url": "https://github.com/acme/app/pull/12",
    "head_ref": "feature/refunds",
    "head_sha": "abc1234",
    "base_ref": "main",
    "imported_at": "2026-07-29T12:00:00Z",
    "fetched_at": "2026-07-29T12:00:00Z",
}


def _git(root: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)


def _write_prs(repo: Path, worktree: str) -> None:
    (repo / ".codechroma").mkdir(exist_ok=True)
    (repo / ".codechroma" / "prs.json").write_text(
        json.dumps({"version": 1, "prs": [{**PR_ENTRY, "worktree": worktree}]})
    )


@pytest.fixture
def repo_with_open_pr(tmp_path, monkeypatch):
    """A repository whose prs.json already names a pull-request worktree, as after a restart."""
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _git(repo, "init")
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "initial")
    pr_root = repo / ".codechroma" / "worktrees" / "pr-12"
    pr_root.mkdir(parents=True)
    (pr_root / "marker.py").write_text("value = 1\n")
    _write_prs(repo, str(pr_root))
    monkeypatch.setenv("codechroma_WORKSPACES_DIR", str(tmp_path / "elsewhere"))
    return repo, pr_root


@pytest.fixture
def rebooted(repo_with_open_pr, make_bridge):
    """The bridge as it comes up against that repository -- the boot path under test."""
    return make_bridge(repo_with_open_pr[0])


def test_an_open_pull_request_is_registered_at_boot(rebooted, repo_with_open_pr):
    assert rebooted.registry.is_registered("pr-12")
    assert rebooted.registry.root_for("pr-12") == repo_with_open_pr[1]


def test_it_does_not_silently_resolve_to_the_main_repository(rebooted):
    assert rebooted.registry.get("pr-12") is not rebooted.registry.main


def test_it_comes_back_read_only(rebooted):
    assert rebooted.registry.is_read_only("pr-12")
    assert rebooted.registry.get("pr-12").read_only


def test_its_diagram_still_points_at_the_main_checkout(rebooted, repo_with_open_pr):
    repo, _pr_root = repo_with_open_pr
    pr_c1 = rebooted.registry.get("pr-12").diagram_path("c1")

    assert pr_c1 == rebooted.registry.main.diagram_path("c1")
    assert pr_c1.parent.parent.parent.parent == repo


def test_its_diff_base_is_the_fetched_base_ref(rebooted):
    assert rebooted.registry.get("pr-12").base_ref == "refs/codechroma/pr/12/base"


def test_a_vanished_worktree_is_flagged_rather_than_dropped(tmp_path, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _git(repo, "init")
    _write_prs(repo, str(tmp_path / "gone"))

    bridge = make_bridge(repo)

    assert bridge.pr_manager.get(12).worktree_lost
    assert bridge.list_prs()["prs"][0]["worktree_lost"] is True


def test_an_active_pull_request_survives_the_restart(repo_with_open_pr, make_bridge):
    repo, _pr_root = repo_with_open_pr
    (repo / ".codechroma" / "agents.json").write_text(
        json.dumps({"version": 1, "agents": [], "active_workspace": "pr-12"})
    )

    bridge = make_bridge(repo)

    assert bridge.agent_manager.active_workspace == "pr-12"


def test_an_active_workspace_that_no_longer_exists_falls_back_to_main(tmp_path, make_bridge):
    repo = tmp_path / "repo"
    shutil.copytree(FIXTURE_REPO, repo)
    _git(repo, "init")
    (repo / ".codechroma").mkdir(exist_ok=True)
    (repo / ".codechroma" / "agents.json").write_text(
        json.dumps({"version": 1, "agents": [], "active_workspace": "pr-99"})
    )

    bridge = make_bridge(repo)

    assert bridge.agent_manager.active_workspace == "main"
