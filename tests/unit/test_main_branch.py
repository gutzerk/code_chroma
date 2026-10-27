"""main_branch against a real temporary repository: current branch and listing."""

import subprocess
from pathlib import Path

import pytest

from codechroma.bridge.agents import main_branch
from tests.conftest import git


def _init_repo(root: Path) -> None:
    git(root, "init")
    git(root, "config", "user.email", "test@example.com")
    git(root, "config", "user.name", "Test")
    (root / "app.py").write_text("value = 1\n", encoding="utf-8")
    git(root, "add", "-A")
    git(root, "commit", "-m", "initial")


@pytest.fixture
def repo(tmp_path) -> Path:
    root = tmp_path / "repo"
    root.mkdir()
    _init_repo(root)
    return root


def test_current_branch_reads_mains_checkout(repo):
    git(repo, "checkout", "-b", "feature-x")

    assert main_branch.current_branch(repo) == "feature-x"


def test_current_branch_is_none_on_a_detached_head(repo):
    commit = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, check=True, capture_output=True, text=True
    ).stdout.strip()
    git(repo, "checkout", commit)

    assert main_branch.current_branch(repo) is None


def test_list_branches_reports_every_local_branch(repo):
    git(repo, "branch", "feature-x")
    git(repo, "branch", "feature-y")

    branches = main_branch.list_branches(repo)

    assert {"feature-x", "feature-y"}.issubset(set(branches))
