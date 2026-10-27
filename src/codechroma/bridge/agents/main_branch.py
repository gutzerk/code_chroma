"""The main repo's checked-out branch: read it and list local branches (never switch it)."""

from __future__ import annotations

from pathlib import Path

from codechroma.bridge import git_cmd


def current_branch(repo_root: Path) -> str | None:
    """The branch main is on, or None for a detached HEAD or a git failure."""
    result = git_cmd.run_git(repo_root, "rev-parse", "--abbrev-ref", "HEAD")
    if result is None:
        return None
    name = result.strip()
    return None if not name or name == "HEAD" else name


def list_branches(repo_root: Path) -> list[str]:
    """Every local branch, in `git for-each-ref`'s order."""
    result = git_cmd.run_git(repo_root, "for-each-ref", "--format=%(refname:short)", "refs/heads")
    return [line for line in (result or "").splitlines() if line]
