"""The pathspec-based noise/.gitignore exclusion pass added to engine._iter_repo_files."""

from pathlib import Path

from codechroma.engine import IGNORED_DIRS, _iter_repo_files
from codechroma.skills import is_synced_skill_path

FIXTURE_REPO = Path(__file__).parent.parent / "fixtures" / "repo_scan_exclusions"


def test_real_source_file_is_kept():
    paths = _iter_repo_files(FIXTURE_REPO)

    assert "real.py" in paths


def test_agent_worktree_shaped_path_is_excluded():
    paths = _iter_repo_files(FIXTURE_REPO)

    assert ".claude/worktrees/agent-x/scratch.py" not in paths


def test_vendor_path_is_excluded():
    paths = _iter_repo_files(FIXTURE_REPO)

    assert "vendor/thirdparty.py" not in paths


def test_file_excluded_only_by_a_nested_gitignore():
    paths = _iter_repo_files(FIXTURE_REPO)

    assert "sub/ignored.py" not in paths
    assert "sub/kept.py" in paths


def test_ignored_dirs_and_synced_skill_path_are_unchanged():
    assert IGNORED_DIRS == {
        ".git", "__pycache__", ".venv", "venv", "node_modules", ".codechroma", "dist", "build",
        ".mypy_cache", ".pytest_cache", ".ruff_cache", ".idea", ".vscode", ".DS_Store",
        ".editorconfig",
    }
    assert is_synced_skill_path(".claude/skills/codechroma-wiki-general-update/SKILL.md") is True
    assert is_synced_skill_path(".claude/worktrees/agent-x/scratch.py") is False
