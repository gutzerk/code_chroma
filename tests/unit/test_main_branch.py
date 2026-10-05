"""main_branch against a real temporary repository: current branch, listing, checkout safety."""

import subprocess
from pathlib import Path

import pytest

from codechroma.bridge.agents import main_branch
from codechroma.bridge.git_long import GitLongError


def _git(root: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)


def _clone(remote: Path, dest: Path) -> None:
    subprocess.run(["git", "clone", str(remote), str(dest)], check=True, capture_output=True)


def _new_commit(repo: Path, value: str) -> None:
    (repo / "app.py").write_text(f"value = {value}\n", encoding="utf-8")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", f"set value = {value}")


def _init_repo(root: Path) -> None:
    _git(root, "init")
    _git(root, "config", "user.email", "test@example.com")
    _git(root, "config", "user.name", "Test")
    (root / "app.py").write_text("value = 1\n", encoding="utf-8")
    _git(root, "add", "-A")
    _git(root, "commit", "-m", "initial")


@pytest.fixture
def repo(tmp_path) -> Path:
    root = tmp_path / "repo"
    root.mkdir()
    _init_repo(root)
    return root


def test_current_branch_reads_mains_checkout(repo):
    _git(repo, "checkout", "-b", "feature-x")

    assert main_branch.current_branch(repo) == "feature-x"


def test_current_branch_is_none_on_a_detached_head(repo):
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, check=True, capture_output=True, text=True
    ).stdout.strip()
    _git(repo, "checkout", commit)

    assert main_branch.current_branch(repo) is None


def test_list_branches_reports_every_local_branch(repo):
    _git(repo, "branch", "feature-x")
    _git(repo, "branch", "feature-y")

    branches = main_branch.list_branches(repo)

    assert {"feature-x", "feature-y"}.issubset(set(branches))


def test_checkout_switches_the_working_tree(repo):
    _git(repo, "branch", "feature-x")

    main_branch.checkout(repo, "feature-x")

    assert main_branch.current_branch(repo) == "feature-x"


def test_checkout_refuses_an_unknown_branch(repo):
    with pytest.raises(main_branch.UnknownBranchError):
        main_branch.checkout(repo, "does-not-exist")


def test_checkout_carries_over_an_uncommitted_change_the_target_branch_does_not_touch(repo):
    _git(repo, "branch", "feature-x")
    (repo / "app.py").write_text("value = 2\n", encoding="utf-8")

    main_branch.checkout(repo, "feature-x")

    assert main_branch.current_branch(repo) == "feature-x"
    assert (repo / "app.py").read_text(encoding="utf-8") == "value = 2\n"


def test_checkout_carries_over_an_untracked_file(repo):
    _git(repo, "branch", "feature-x")
    (repo / "scratch.txt").write_text("mine\n", encoding="utf-8")

    main_branch.checkout(repo, "feature-x")

    assert main_branch.current_branch(repo) == "feature-x"
    assert (repo / "scratch.txt").read_text(encoding="utf-8") == "mine\n"


def test_checkout_refused_by_a_real_conflict_does_not_switch_branches(repo):
    before = main_branch.current_branch(repo)
    _git(repo, "checkout", "-b", "feature-x")
    (repo / "app.py").write_text("value = 3\n", encoding="utf-8")
    _git(repo, "commit", "-am", "change on feature-x")
    _git(repo, "checkout", before)
    (repo / "app.py").write_text("value = 2\n", encoding="utf-8")

    with pytest.raises(main_branch.DirtyWorkingTreeError):
        main_branch.checkout(repo, "feature-x")

    assert main_branch.current_branch(repo) == before


def test_checkout_reports_a_worktree_conflict_as_a_checkout_error(repo, tmp_path):
    _git(repo, "branch", "feature-x")
    _git(repo, "worktree", "add", str(tmp_path / "other-worktree"), "feature-x")

    with pytest.raises(main_branch.CheckoutError):
        main_branch.checkout(repo, "feature-x")


@pytest.mark.parametrize(
    "relative",
    [
        ".codechroma/graph.db",
        ".claude/skills/codechroma-patterns/SKILL.md",
        ".claude/skills/mine/SKILL.md",
    ],
)
def test_checkout_carries_over_any_untracked_file_regardless_of_who_wrote_it(repo, relative):
    _git(repo, "branch", "feature-x")
    ours = repo / relative
    ours.parent.mkdir(parents=True, exist_ok=True)
    ours.write_text("ours\n", encoding="utf-8")

    main_branch.checkout(repo, "feature-x")

    assert main_branch.current_branch(repo) == "feature-x"


def test_update_branch_fast_forwards_from_its_upstream(tmp_path):
    origin = tmp_path / "origin.git"
    subprocess.run(["git", "init", "--bare", str(origin)], check=True, capture_output=True)
    repo = tmp_path / "repo"
    _clone(origin, repo)
    _git(repo, "config", "user.email", "test@example.com")
    _git(repo, "config", "user.name", "Test")
    _new_commit(repo, "1")
    _git(repo, "branch", "-M", "main")
    _git(repo, "push", "-u", "origin", "main")
    feeder = tmp_path / "feeder"
    _clone(origin, feeder)
    _git(feeder, "config", "user.email", "test@example.com")
    _git(feeder, "config", "user.name", "Test")
    _new_commit(feeder, "2")
    _git(feeder, "push")

    main_branch.update_branch(repo)

    assert (repo / "app.py").read_text(encoding="utf-8") == "value = 2\n"
    assert main_branch.current_branch(repo) == "main"


def test_update_branch_raises_when_the_branch_tracks_no_upstream(repo):
    with pytest.raises(GitLongError):
        main_branch.update_branch(repo)
