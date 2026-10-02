"""Fetching a pull request's head into a detached worktree the canvas can analyze.

🔴 The refs land under **our own** `refs/codechroma/pr/<n>/` namespace, never
`refs/remotes/origin/*`. Writing the user's remote-tracking refs would silently change what their
`git status` says about ahead/behind and what `git log origin/main` shows — a side effect on their
repository they never asked for. `refs/codechroma/` is invisible to `git branch -a`.

The same fetch brings the *base* branch down, because that is what makes `Workspace.diff_base()`
resolvable at all: the merge-base can't be computed against a ref this checkout has never seen.
No `--depth`: a shallow fetch into a full repository breaks `merge-base` outright.

The worktree is **detached**, so a review never creates a local branch that could hold a checkout
hostage or leak into the user's branch list. Skills ARE installed into it (like an agent's
worktree): a read-only PR still runs diagram skills (e.g. impact) whose artifacts land in the
worktree itself, and without a local copy the headless agent has no access to them.
"""

from __future__ import annotations

import logging
from pathlib import Path

from codechroma.bridge.agents import worktree
from codechroma.bridge.git_cmd import ensure_excluded, run_git
from codechroma.bridge.git_long import run_git_long
from codechroma.bridge.skill_sync import WORKTREE_EXCLUDES, install_into_worktree
from codechroma.bridge.workspaces import PR_ID_PREFIX

logger = logging.getLogger("uvicorn.error")

_REF_ROOT = "refs/codechroma/pr"


def workspace_id(number: int) -> str:
    return f"{PR_ID_PREFIX}{number}"


def local_head_ref(number: int) -> str:
    """Where this bridge keeps the pull request's head: our namespace, not a remote-tracking ref."""
    return f"{_REF_ROOT}/{number}/head"


def local_base_ref(number: int) -> str:
    """Where this bridge keeps the pull request's base, so diff_base() has something to resolve."""
    return f"{_REF_ROOT}/{number}/base"


def worktree_path(main_root: Path, number: int) -> Path:
    """Beside the agents' worktrees, so `$codechroma_WORKSPACES_DIR` moves both at once."""
    return worktree.worktree_path(main_root, workspace_id(number))


def fetch_refs(main_root: Path, number: int, base_ref_name: str) -> None:
    """One round trip for both refs; raises GitLongError with a reason the route can render."""
    run_git_long(
        main_root,
        "fetch",
        "--no-tags",
        "origin",
        f"+refs/pull/{number}/head:{local_head_ref(number)}",
        f"+refs/heads/{base_ref_name}:{local_base_ref(number)}",
    )


def head_sha(main_root: Path, number: int) -> str | None:
    resolved = run_git(main_root, "rev-parse", "--verify", "--quiet", local_head_ref(number))
    return resolved.strip() if resolved and resolved.strip() else None


def _install_skills(root: Path) -> None:
    """Copies the skills into a PR worktree (excluded first), so its diagram runs can start."""
    install_into_worktree(root, "prs")


def import_pr(main_root: Path, number: int, base_ref_name: str) -> tuple[Path, str]:
    """Fetches the pull request and checks its head out detached; returns (worktree, head sha)."""
    # Excluded *before* the worktree exists, or GitSync reads it as a few thousand untracked files.
    ensure_excluded(main_root, WORKTREE_EXCLUDES)
    fetch_refs(main_root, number, base_ref_name)
    sha = head_sha(main_root, number)
    if sha is None:
        raise worktree.WorktreeError(f"fetched no head for pull request {number}")
    path = worktree_path(main_root, number)
    worktree.add_detached(main_root, path, sha)
    _install_skills(path)
    logger.info("prs: imported #%s at %s into %s", number, sha[:8], path)
    return path, sha


def refresh_pr(
    main_root: Path, number: int, path: Path, base_ref_name: str, current_sha: str
) -> tuple[str, bool]:
    """Re-fetches and moves the worktree if the head moved; returns (head sha, whether it moved)."""
    fetch_refs(main_root, number, base_ref_name)
    sha = head_sha(main_root, number)
    if sha is None:
        raise worktree.WorktreeError(f"fetched no head for pull request {number}")
    if sha == current_sha and path.is_dir():
        return sha, False
    if not path.is_dir():
        # The directory was deleted by hand or by `git clean -xdf` in the main repo.
        worktree.prune(main_root)
        worktree.add_detached(main_root, path, sha)
        _install_skills(path)
        return sha, True
    worktree.checkout_detached(path, sha)
    return sha, True


def remove_pr(main_root: Path, number: int, path: Path) -> None:
    """Drops the worktree and both refs; leaving the refs would pin a fork's objects forever."""
    # force=True is honest here: nothing in a pull-request worktree is ever the user's own work.
    if path.is_dir():
        worktree.remove(main_root, path, force=True)
    worktree.prune(main_root)
    for ref in (local_head_ref(number), local_base_ref(number)):
        run_git(main_root, "update-ref", "-d", ref)
