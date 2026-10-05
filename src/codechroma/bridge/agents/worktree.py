"""Thin wrappers over `git worktree`, plus the branch/directory slug and where worktrees live.

Built on git_cmd.run_git/run_git_raw rather than subprocess directly: that module already owns the
timeout and the "git couldn't run at all" case. Worktrees live *inside* the repository, at
`<repo>/.codechroma/worktrees/<agent-id>`, so the branch directory sits next to the
code the agent is working on instead of in a home-dir path the user has no reason to know about.
Nesting is safe because `.codechroma` is already excluded three times over: `live.py`'s RepoWatcher
filter, `engine.py`'s analysis walk, and the repo's `info/exclude` (`git_cmd.ensure_excluded`).
🔴 The one hazard it does introduce: `git clean -xdf` in the main repo deletes ignored-and-untracked
files, which now includes every agent worktree. $codechroma_WORKSPACES_DIR is the escape hatch.
"""

from __future__ import annotations

import os
import re
import shutil
import unicodedata
from pathlib import Path

from codechroma.bridge.git_cmd import run_git, run_git_or_raise, run_git_raw
from codechroma.bridge.git_long import GitLongError, run_git_long
from codechroma.config import settings
from codechroma.errors import codechromaError

WORKSPACES_DIR_ENV = "codechroma_WORKSPACES_DIR"

BRANCH_PREFIX = "agent/"

_NON_SLUG = re.compile(r"[^a-z0-9]+")


def max_slug_length() -> int:
    # Long enough to stay readable, short enough for a git ref plus a macOS path under the home dir.
    return settings.worktree.max_slug_length


def _max_submodule_depth() -> int:
    # Submodules can nest; this only bounds a pathological .gitmodules cycle, not real repositories.
    return settings.worktree.max_submodule_depth


class WorktreeError(codechromaError):
    """A git worktree command failed; the message carries git's own stderr."""


def slugify(title: str, fallback_index: int = 1) -> str:
    """Lowercase ASCII slug for a branch and directory name; `agent<n>` when nothing survives."""
    folded = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii")
    slug = _NON_SLUG.sub("-", folded.lower()).strip("-")[:max_slug_length()].strip("-")
    return slug or f"agent{fallback_index}"


def worktrees_root(repo_root: Path) -> Path:
    """`$codechroma_WORKSPACES_DIR` when set, else `<repo>/.codechroma/worktrees`."""
    configured = os.environ.get(WORKSPACES_DIR_ENV, "").strip()
    if configured:
        return Path(configured).expanduser()
    return repo_root / ".codechroma" / "worktrees"


def legacy_worktrees_root() -> Path:
    """Where worktrees used to live; read only by the one-time migration, so it retires itself."""
    return Path.home() / ".codechroma" / "worktrees"


def worktree_path(repo_root: Path, agent_id: str) -> Path:
    """`<repo>/.codechroma/worktrees/<id>`, or `<env>/<repo-slug>/<id>` when overridden."""
    # The repo-slug level is only meaningful for the override: one external dir serves many repos.
    if os.environ.get(WORKSPACES_DIR_ENV, "").strip():
        return worktrees_root(repo_root) / slugify(repo_root.name) / agent_id
    return worktrees_root(repo_root) / agent_id


def branch_name(agent_id: str) -> str:
    """The branch an agent works on, namespaced so it never collides with a human's branch."""
    return f"{BRANCH_PREFIX}{agent_id}"


def _run_git_or_raise(repo_root: Path, *args: str, description: str) -> None:
    """Runs a git command, raising WorktreeError with git's stderr (or description) on failure."""
    run_git_or_raise(repo_root, *args, error_cls=WorktreeError, description=description)


def add(repo_root: Path, branch: str, path: Path, start_point: str | None = None) -> Path:
    """`git worktree add -b <branch> <path> [<start_point>]`; raises WorktreeError on failure."""
    path.parent.mkdir(parents=True, exist_ok=True)
    args = ["worktree", "add", "-b", branch, str(path)]
    if start_point is not None:
        args.append(start_point)
    _run_git_or_raise(repo_root, *args, description="git worktree add")
    return path


def attach(repo_root: Path, branch: str, path: Path) -> Path:
    """`git worktree add <path> <branch>`: recreates a checkout for an existing branch."""
    path.parent.mkdir(parents=True, exist_ok=True)
    _run_git_or_raise(
        repo_root, "worktree", "add", str(path), branch, description="git worktree add"
    )
    return path


def add_detached(repo_root: Path, path: Path, commit: str) -> Path:
    """`git worktree add --detach <path> <commit>`: a checkout of a commit with no branch at all."""
    # Detached on purpose: a fetched PR head gets no local branch to hold hostage or leak.
    path.parent.mkdir(parents=True, exist_ok=True)
    _run_git_or_raise(
        repo_root, "worktree", "add", "--detach", str(path), commit, description="git worktree add"
    )
    return path


def checkout_detached(worktree_path: Path, commit: str) -> None:
    """Moves an existing detached worktree onto another commit; raises WorktreeError on refusal."""
    # No --force: git refusing over a local edit is information, and discarding it silently is not.
    try:
        run_git_long(worktree_path, "checkout", "--detach", commit)
    except GitLongError as exc:
        raise WorktreeError(str(exc)) from exc


def remove(repo_root: Path, path: Path, force: bool = False) -> None:
    """`git worktree remove`; git itself refuses on a dirty worktree, so propagate that refusal."""
    args = ["worktree", "remove"]
    if force:
        args.append("--force")
    args.append(str(path))
    _run_git_or_raise(repo_root, *args, description="git worktree remove")


def delete_branch(repo_root: Path, branch: str, force: bool = True) -> None:
    """Deletes the agent's branch; only ever called when the user explicitly asked for it."""
    _run_git_or_raise(
        repo_root, "branch", "-D" if force else "-d", branch, description="git branch delete"
    )


def move(repo_root: Path, source: Path, target: Path) -> None:
    """`git worktree move`, falling back to a directory move plus `git worktree repair`."""
    target.parent.mkdir(parents=True, exist_ok=True)
    result = run_git_raw(repo_root, "worktree", "move", str(source), str(target))
    if result is not None and result.returncode == 0:
        _repair_submodule_gitdirs(source, target)
        return
    # git refuses to move a locked worktree or one with submodules; a plain move plus repair does.
    reason = _stderr_of(result) if result is not None else "git could not be run"
    try:
        shutil.move(str(source), str(target))
    except (OSError, shutil.Error) as exc:
        raise WorktreeError(f"{reason}; moving the directory also failed: {exc}") from exc
    if run_git(repo_root, "worktree", "repair", str(target)) is None:
        raise WorktreeError(f"{reason}; `git worktree repair {target}` then failed too")
    _repair_submodule_gitdirs(source, target)


def _repair_submodule_gitdirs(source: Path, target: Path) -> None:
    """Re-anchors each submodule's two pointers, which neither `move` nor `repair` rewrites."""
    # Both are stored *relative*, so a move breaks them: .git -> gitdir, and core.worktree back.
    for git_file in _submodule_git_files(target):
        git_dir = _repointed_git_dir(git_file, source, target)
        if git_dir is None:
            continue
        pointer = f"gitdir: {os.path.relpath(git_dir, git_file.parent)}\n"
        # r+ rather than write_text: Windows refuses to truncate-recreate a hidden file.
        with git_file.open("r+", encoding="utf-8") as handle:
            handle.truncate(0)
            handle.write(pointer)
        _set_core_worktree(git_dir, git_file.parent)


def _set_core_worktree(git_dir: Path, work_tree: Path) -> None:
    """Points the submodule's git dir back at its working tree, the other half of the pair."""
    # Via the env: every discovery-based form chdirs to the stale value before it could fix it.
    environment = {**os.environ, "GIT_DIR": str(git_dir), "GIT_WORK_TREE": str(work_tree)}
    result = run_git_raw(
        work_tree, "config", "core.worktree", os.path.relpath(work_tree, git_dir), env=environment
    )
    if result is None or result.returncode != 0:
        raise WorktreeError(f"could not repoint the submodule at {work_tree} after the move")


def _repointed_git_dir(git_file: Path, source: Path, target: Path) -> Path | None:
    """The git dir a moved submodule's `.git` file still means, or None if it needs no fixing."""
    pointer = git_file.read_text(encoding="utf-8").strip()
    if not pointer.startswith("gitdir:"):
        return None
    recorded = pointer.removeprefix("gitdir:").strip()
    if (git_file.parent / recorded).is_dir():
        return None
    # The path was relative to where this file used to be, so re-anchor it there and re-express it.
    was_at = source / git_file.parent.relative_to(target)
    resolved = Path(os.path.normpath(was_at / recorded))
    return resolved if resolved.is_dir() else None


def _submodule_git_files(root: Path, depth: int = 0) -> list[Path]:
    """Every submodule `.git` file under `root`, found via `.gitmodules` rather than a walk."""
    if depth > _max_submodule_depth():
        return []
    found: list[Path] = []
    for relative in _submodule_paths(root / ".gitmodules"):
        candidate = root / relative
        if (candidate / ".git").is_file():
            found.append(candidate / ".git")
        found.extend(_submodule_git_files(candidate, depth + 1))
    return found


def _submodule_paths(gitmodules: Path) -> list[str]:
    """The `path =` values of a .gitmodules file; empty when there is none or it can't be read."""
    try:
        lines = gitmodules.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    paths = []
    for line in lines:
        key, separator, value = line.partition("=")
        if separator and key.strip() == "path" and value.strip():
            paths.append(value.strip())
    return paths


def prune(repo_root: Path) -> None:
    """`git worktree prune`, run at startup so a hand-deleted directory stops haunting git."""
    run_git(repo_root, "worktree", "prune")


def list_worktrees(repo_root: Path) -> list[dict]:
    """`git worktree list --porcelain` parsed into {path, head, branch} — detects hand-deletions."""
    raw = run_git(repo_root, "worktree", "list", "--porcelain")
    if raw is None:
        return []
    entries: list[dict] = []
    current: dict = {}
    for line in raw.splitlines():
        if not line.strip():
            if current:
                entries.append(current)
                current = {}
            continue
        key, _, value = line.partition(" ")
        if key == "worktree":
            current = {"path": value, "head": None, "branch": None}
        elif key == "HEAD":
            current["head"] = value
        elif key == "branch":
            current["branch"] = value.removeprefix("refs/heads/")
    if current:
        entries.append(current)
    return entries


def list_agent_branches(repo_root: Path) -> list[str]:
    """Every local branch under `agent/`, including ones no live worktree points at any more."""
    raw = run_git(repo_root, "branch", "--list", f"{BRANCH_PREFIX}*", "--format=%(refname:short)")
    return [line for line in (raw or "").splitlines() if line]


def main_branch(repo_root: Path) -> str:
    """The integration branch: origin's default when known, else main/master, else HEAD."""
    remote_head = run_git(repo_root, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD")
    if remote_head:
        name = remote_head.strip().removeprefix("refs/remotes/origin/")
        if name:
            return name
    for candidate in ("main", "master"):
        if run_git(repo_root, "rev-parse", "--verify", "--quiet", f"refs/heads/{candidate}"):
            return candidate
    current = run_git(repo_root, "rev-parse", "--abbrev-ref", "HEAD")
    return current.strip() if current and current.strip() else "HEAD"


def _stderr_of(result: object) -> str:
    return (getattr(result, "stderr", "") or "").strip()
