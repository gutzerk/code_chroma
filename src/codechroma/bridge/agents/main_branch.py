"""The main repo's checked-out branch: read it, list local branches, switch it safely.

Separate from `worktree.main_branch()` (the *default/integration* branch used for diffing) -- this
is what the user currently has checked out, which is what the branch switcher reads and changes.
"""

from __future__ import annotations

from pathlib import Path

from codechroma.bridge import git_cmd, git_long
from codechroma.bridge.agents import worktree
from codechroma.errors import codechromaError

# Git's own refusal text for both conflict shapes (overwritten or removed) ends with this line.
_REAL_CONFLICT_MARKER = "before you switch branches"


class UnknownBranchError(codechromaError):
    """No local branch by that name."""


class DirtyWorkingTreeError(codechromaError):
    """Refuses only when the target branch would actually overwrite or remove local work."""


class CheckoutError(codechromaError):
    """A known, clean-tree branch still failed to check out (e.g. it's held by another worktree)."""


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


def switchable_branches(repo_root: Path) -> list[str]:
    """The branches `checkout` can actually reach: every local one no *other* worktree holds."""
    # A branch an agent's worktree holds could only ever answer "already used by worktree at ...".
    git_root = git_cmd.detect_git_root(repo_root) or repo_root
    held = {
        entry["branch"]
        for entry in worktree.list_worktrees(repo_root)
        if entry.get("branch") and not _is_main_worktree(entry.get("path"), git_root)
    }
    return [branch for branch in list_branches(repo_root) if branch not in held]


def _is_main_worktree(path: object, git_root: Path) -> bool:
    """Whether a `git worktree list` entry is main's own tree -- the one a checkout happens in."""
    if not isinstance(path, str) or not path:
        return False
    return Path(path).resolve() == git_root.resolve()


def checkout(repo_root: Path, branch: str) -> str:
    """Switches main's tree to `branch`; local work rides along unless it collides with it."""
    if branch not in list_branches(repo_root):
        raise UnknownBranchError(branch)
    result = git_cmd.run_git_raw(repo_root, "checkout", branch)
    if result is None:
        raise CheckoutError(f"git checkout {branch} could not run")
    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        if _REAL_CONFLICT_MARKER in stderr:
            raise DirtyWorkingTreeError(stderr or branch)
        raise CheckoutError(stderr or f"git checkout {branch} failed")
    return branch


def update_branch(repo_root: Path) -> str | None:
    """Fast-forwards main's current branch from its upstream — PyCharm's Update, the safe form.

    `git pull --ff-only` refuses to create a merge or rebase commit, so it never invents history; it
    either moves the branch cleanly (with the working tree riding along) or reports why not. Raises
    GitLongError with git's own stderr on failure (no upstream, diverged, network)."""
    git_long.run_git_long(repo_root, "pull", "--ff-only")
    return current_branch(repo_root)
