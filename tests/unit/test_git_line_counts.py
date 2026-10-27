"""line_counts: numstat for tracked edits and whole-file counts for untracked additions."""

import pytest

from codechroma.bridge.git_cmd import line_counts, working_tree_status
from tests.conftest import git


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    git(root, "init", "-b", "main")
    git(root, "config", "user.email", "test@example.com")
    git(root, "config", "user.name", "Test")
    (root / "edited.py").write_text("a\nb\nc\n", encoding="utf-8")
    git(root, "add", "-A")
    git(root, "commit", "-m", "initial")
    return root


def test_line_counts_cover_edits_and_untracked_files(repo):
    (repo / "edited.py").write_text("a\nB\nc\nd\n", encoding="utf-8")
    (repo / "fresh.py").write_text("x\ny\n", encoding="utf-8")
    statuses = working_tree_status(repo, repo, "HEAD").statuses

    counts = line_counts(repo, "HEAD", statuses)

    assert counts == {"edited.py": (2, 1), "fresh.py": (2, 0)}
