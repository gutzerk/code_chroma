"""The two porcelain parsers must agree wherever they overlap.

`working_tree_status` has two implementations: `_uncommitted_status` for `base="HEAD"` (kept
byte-for-byte as the original single `git status`) and `_status_against` for any other base. They
are deliberately separate — the "HEAD" path is load-bearing and was not worth rewriting — but
nothing pinned them to the same answers, so a fix to one could silently drift from the other.

Comparing `base="HEAD"` against `base=<the sha HEAD points at>` puts both parsers on the same
working tree, which is the overlap where they must not disagree.
"""

import subprocess
from pathlib import Path

import pytest

from codechroma.bridge.git_cmd import working_tree_status


def _git(root: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=root, check=True, capture_output=True, text=True
    ).stdout


@pytest.fixture
def repo(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    _git(root, "init", "-b", "main")
    _git(root, "config", "user.email", "test@example.com")
    _git(root, "config", "user.name", "Test")
    (root / "kept.py").write_text("value = 1\n")
    (root / "edited.py").write_text("value = 2\n")
    (root / "removed.py").write_text("value = 3\n")
    (root / "renamed.py").write_text("value = 4\n")
    _git(root, "add", "-A")
    _git(root, "commit", "-m", "initial")
    return root


def _both_ways(root: Path) -> tuple[dict, dict]:
    """(what the HEAD parser reports, what the against-a-commit parser reports) for one tree."""
    head_sha = _git(root, "rev-parse", "HEAD").strip()
    return (
        working_tree_status(root, root, "HEAD").statuses,
        working_tree_status(root, root, head_sha).statuses,
    )


def _modify(root: Path) -> None:
    (root / "edited.py").write_text("value = 99\n")


def _add_untracked(root: Path) -> None:
    (root / "brand_new.py").write_text("value = 5\n")


def _add_staged(root: Path) -> None:
    (root / "staged_new.py").write_text("value = 6\n")
    _git(root, "add", "staged_new.py")


def _delete(root: Path) -> None:
    (root / "removed.py").unlink()


def _delete_staged(root: Path) -> None:
    _git(root, "rm", "-q", "removed.py")


def _rename_staged(root: Path) -> None:
    _git(root, "mv", "renamed.py", "moved.py")


def _everything(root: Path) -> None:
    _modify(root)
    _add_untracked(root)
    _add_staged(root)
    _delete(root)
    _rename_staged(root)


@pytest.mark.parametrize(
    "change",
    [_modify, _add_untracked, _add_staged, _delete, _delete_staged, _rename_staged, _everything],
    ids=["modified", "untracked", "staged-add", "deleted", "staged-delete", "renamed", "all"],
)
def test_both_parsers_report_the_same_paths_and_kinds(repo, change):
    change(repo)

    from_head, from_commit = _both_ways(repo)

    assert from_head == from_commit


def test_a_clean_tree_is_empty_either_way(repo):
    from_head, from_commit = _both_ways(repo)

    assert from_head == {}
    assert from_commit == {}
