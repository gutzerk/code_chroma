"""The comparison base as an argument, against a real temporary repository with real worktrees."""

import subprocess
from pathlib import Path

import pytest

from codechroma.bridge.agents import worktree
from codechroma.bridge.git_cmd import detect_git_root, working_tree_status
from codechroma.bridge.git_diff import compute_function_diffs
from codechroma.engine import GraphEngine
from codechroma.summarize.ai_summarizer import AISummarizer

ORIGINAL = 'def charge(amount):\n    """Charge."""\n    return amount\n'
PATCHED = 'def charge(amount):\n    """Charge."""\n    return amount * 2\n'


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=root, check=True, capture_output=True, text=True
    ).stdout


def _commit(root: Path, message: str) -> None:
    _git(root, "add", "-A")
    _git(root, "commit", "-m", message)


@pytest.fixture
def repo(tmp_path, monkeypatch):
    root = tmp_path / "repo"
    root.mkdir()
    _git(root, "init", "-b", "main")
    _git(root, "config", "user.email", "test@example.com")
    _git(root, "config", "user.name", "Test")
    (root / "payments.py").write_text(ORIGINAL)
    _commit(root, "initial")
    monkeypatch.setenv(worktree.WORKSPACES_DIR_ENV, str(tmp_path / "worktrees"))
    return root


@pytest.fixture
def agent(repo, tmp_path):
    path = worktree.worktree_path(repo, "refund-flow")
    worktree.add(repo, "agent/refund-flow", path)
    _git(path, "config", "user.email", "agent@example.com")
    _git(path, "config", "user.name", "Agent")
    return path


def merge_base(path: Path) -> str:
    return _git(path, "merge-base", "main", "HEAD").strip()


def analyzed(root: Path) -> GraphEngine:
    engine = GraphEngine(summarizer=AISummarizer())
    engine.analyze(str(root))
    return engine


def test_head_reproduces_the_uncommitted_only_behaviour(repo):
    (repo / "payments.py").write_text(PATCHED)
    engine = analyzed(repo)

    entries = compute_function_diffs(engine, repo)

    # The changed file now also emits its own file-level `component::` entry alongside the function
    # diff, so the file's box carries a diff. Order is function entries first, file entry appended.
    assert [entry["node_id"] for entry in entries] == [
        "payments.py::function::charge",
        "component::payments.py",
    ]
    assert "amount * 2" in entries[0]["proposed_source"]


def test_an_edit_the_agent_committed_still_shows_in_its_diff(agent):
    (agent / "payments.py").write_text(PATCHED)
    _commit(agent, "agent work")
    engine = analyzed(agent)

    against_head = compute_function_diffs(engine, agent)
    against_base = compute_function_diffs(engine, agent, base=merge_base(agent))

    assert against_head == []
    assert [entry["node_id"] for entry in against_base] == [
        "payments.py::function::charge",
        "component::payments.py",
    ]


def test_a_commit_landing_on_main_does_not_appear_in_the_agents_diff(repo, agent):
    (repo / "unrelated.py").write_text("def other():\n    return 1\n")
    _commit(repo, "someone else's work on main")
    (agent / "payments.py").write_text(PATCHED)
    _commit(agent, "agent work")
    engine = analyzed(agent)

    entries = compute_function_diffs(engine, agent, base=merge_base(agent))

    # Two-dot comparison would report unrelated.py as a deletion — it exists on main, not here.
    assert [entry["node_id"] for entry in entries] == [
        "payments.py::function::charge",
        "component::payments.py",
    ]


def test_the_base_moves_on_its_own_once_main_is_merged_in(repo, agent):
    (repo / "unrelated.py").write_text("def other():\n    return 1\n")
    _commit(repo, "main moves on")
    before = merge_base(agent)

    _git(agent, "merge", "main", "-m", "pull main in")

    assert merge_base(agent) != before
    assert merge_base(agent) == _git(repo, "rev-parse", "main").strip()


def test_an_agents_uncommitted_edit_shows_alongside_its_committed_one(agent):
    (agent / "payments.py").write_text(PATCHED)
    _commit(agent, "agent work")
    (agent / "extra.py").write_text("def extra():\n    return 2\n")
    engine = analyzed(agent)

    entries = compute_function_diffs(engine, agent, base=merge_base(agent))

    names = {entry["name"] for entry in entries}
    assert "charge" in names
    assert "extra" in names


def test_working_tree_status_against_a_base_reports_a_committed_deletion(agent):
    (agent / "payments.py").unlink()
    _commit(agent, "agent removed the module")

    status = working_tree_status(agent, detect_git_root(agent), merge_base(agent))

    assert status.deleted == ["payments.py"]
    assert status.statuses == {"payments.py": "deleted"}


def test_an_unreachable_base_reports_nothing_rather_than_everything(agent):
    (agent / "payments.py").write_text(PATCHED)

    status = working_tree_status(agent, detect_git_root(agent), "0" * 40)

    assert status.changed == []
    assert status.deleted == []
