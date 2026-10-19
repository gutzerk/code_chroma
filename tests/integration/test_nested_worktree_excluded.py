"""Nested `.codechroma/worktrees` stay out of the main graph and git status."""


import pytest

from codechroma.bridge.agents import worktree
from codechroma.bridge.agents.manager import AgentManager
from codechroma.bridge.git_cmd import working_tree_status
from codechroma.engine import GraphEngine
from tests.conftest import git


@pytest.fixture
def repo(tmp_path, monkeypatch):
    root = tmp_path / "repo"
    root.mkdir()
    git(root, "init", "-b", "main")
    git(root, "config", "user.email", "test@example.com")
    git(root, "config", "user.name", "Test")
    (root / "shared.py").write_text("def shared():\n    return 1\n", encoding="utf-8")
    git(root, "add", "-A")
    git(root, "commit", "-m", "initial")
    monkeypatch.delenv(worktree.WORKSPACES_DIR_ENV, raising=False)
    return root


@pytest.fixture
def repo_with_agent(repo, tmp_path):
    manager = AgentManager(repo)
    manager.create("refund flow")
    return repo


def test_the_worktree_really_lands_inside_the_repository(repo_with_agent):
    assert (repo_with_agent / ".codechroma" / "worktrees" / "refund-flow" / "shared.py").is_file()


def test_analysis_of_the_main_repo_skips_the_nested_worktree(repo_with_agent):
    engine = GraphEngine()

    engine.analyze(str(repo_with_agent))

    nodes = engine.snapshot().nodes.values()
    sources = [node.source_path for node in nodes if node.source_path]
    assert sources
    assert not any(".codechroma" in source for source in sources)


def test_the_nested_worktree_never_shows_up_as_an_uncommitted_change(repo_with_agent):
    status = working_tree_status(repo_with_agent, repo_with_agent)

    assert status.changed == []
    assert status.deleted == []
