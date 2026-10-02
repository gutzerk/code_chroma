"""Repository preflight and the first commit, so agents work on a folder that isn't under git yet.

`git worktree add` is impossible while a repository has no commits, and an *empty* initial commit
doesn't help either: the agent's worktree would check out a branch with no files in it. So enabling
agents on a fresh folder has to commit the project's real code — which is why this module computes a
plan (how many files, how many bytes, what looks suspicious) that the UI shows before anything runs.
An existing `.gitignore` is never rewritten; the plan is computed against it and it is left alone.
"""

from __future__ import annotations

import fnmatch
from pathlib import Path

from codechroma.bridge.git_cmd import ensure_excluded, run_git, run_git_raw
from codechroma.bridge.skill_sync import SKILL_EXCLUDE_PATTERNS
from codechroma.config import settings
from codechroma.engine import IGNORED_DIRS
from codechroma.errors import codechromaError

STATE_READY = "ready"
STATE_NO_GIT = "no-git"
STATE_NOT_A_REPO = "not-a-repo"
STATE_NO_COMMITS = "no-commits"
STATE_NESTED = "nested"

# The graph's own exclusions plus .codechroma/, written only when no .gitignore exists at all.
BASE_IGNORES = (
    "node_modules/",
    "dist/",
    "build/",
    "__pycache__/",
    ".venv/",
    "venv/",
    ".codechroma/",
)

def large_file_bytes() -> int:
    return settings.bootstrap.large_file_bytes


# Adds .claude/: only this reversible pre-tick dialog should flag it, not the diff/live-watch paths.
_HEAVY_DIRS = IGNORED_DIRS | {".claude"}

_SECRET_GLOBS = (".env", ".env.*", "*.pem", "*.key", "id_rsa", "id_rsa.*")

# Our own artifact dir is never the user's code, so it must not enter their first commit either.
_ALWAYS_IGNORED = (".git", ".codechroma")

_FIRST_COMMIT_MESSAGE = "Initial commit"

# Written to $GIT_DIR/info/exclude, so `git add -A` never bakes the synced skills in either.
_ALWAYS_IGNORED_PATTERNS = (".codechroma/", *SKILL_EXCLUDE_PATTERNS)

# Used only when the machine has no git identity configured, and only for this one commit.
_FALLBACK_AUTHOR = ("CodeChroma", "codechroma@localhost")


class BootstrapError(codechromaError):
    """Initialization could not produce a repository with a real first commit."""


def preflight(root: Path) -> dict:
    """Repository state plus, when initialization is possible, the plan for the first commit."""
    root = root.resolve()
    if run_git(root, "--version") is None:
        return {"state": STATE_NO_GIT, "root": str(root)}

    toplevel = run_git(root, "rev-parse", "--show-toplevel")
    if toplevel is None:
        return {"state": STATE_NOT_A_REPO, "root": str(root), "plan": commit_plan(root)}

    resolved = Path(toplevel.strip()).resolve()
    if resolved != root:
        return {"state": STATE_NESTED, "root": str(root), "parent_repo": str(resolved)}

    if run_git(root, "rev-parse", "--verify", "--quiet", "HEAD") is None:
        return {"state": STATE_NO_COMMITS, "root": str(root), "plan": commit_plan(root)}

    return {"state": STATE_READY, "root": str(root)}


def commit_plan(
    root: Path,
    extra_ignores: list[str] | None = None,
    include: list[str] | None = None,
) -> dict:
    """The first commit as it lands: every suspicious path excluded unless `include` keeps it."""
    scanned = _walk(root)
    base = _effective_ignores(root) + list(extra_ignores or [])
    suspicious = _suspicious(scanned, _IgnoreRules(base))
    kept = set(include or [])
    rules = _IgnoreRules(
        base
        + [entry["path"] for entry in suspicious if entry["path"] not in kept]
        + [f"!{path}" for path in kept]
    )
    included = [(relative, size) for relative, size in scanned if not rules.ignores(relative)]
    for entry in suspicious:
        entry["preticked"] = entry["path"] not in kept
    return {
        "file_count": len(included),
        "total_bytes": sum(size for _relative, size in included),
        "suspicious": suspicious,
    }


def initialize(root: Path, extra_ignores: list[str] | None = None) -> dict:
    """`git init` (if needed) -> `.gitignore` (if absent) -> `git add -A` -> the first commit."""
    root = root.resolve()
    state = preflight(root)["state"]
    if state == STATE_NO_GIT:
        raise BootstrapError("git is not installed")
    if state == STATE_NESTED:
        raise BootstrapError("the project is inside another repository")
    if state == STATE_READY:
        return {"state": STATE_READY, "created_repo": False, "created_gitignore": False}

    created_repo = False
    if state == STATE_NOT_A_REPO:
        if run_git(root, "init") is None:
            raise BootstrapError("git init failed")
        created_repo = True

    created_gitignore = _write_gitignore(root, extra_ignores or [])
    ensure_excluded(root, _ALWAYS_IGNORED_PATTERNS)
    if run_git(root, "add", "-A") is None:
        raise BootstrapError("git add -A failed")
    if not run_git(root, "diff", "--cached", "--name-only"):
        raise BootstrapError(
            "nothing to commit — an agent worktree needs a first commit that carries real files"
        )
    _commit(root)
    head = run_git(root, "rev-parse", "HEAD")
    return {
        "state": STATE_READY,
        "created_repo": created_repo,
        "created_gitignore": created_gitignore,
        "commit": head.strip() if head else None,
    }


def _commit(root: Path) -> None:
    """Commits everything staged, supplying an identity only when the machine has none."""
    result = run_git_raw(root, "commit", "-m", _FIRST_COMMIT_MESSAGE)
    if result is not None and result.returncode == 0:
        return
    name, email = _FALLBACK_AUTHOR
    retry = run_git_raw(
        root, "-c", f"user.name={name}", "-c", f"user.email={email}",
        "commit", "-m", _FIRST_COMMIT_MESSAGE,
    )
    if retry is None or retry.returncode != 0:
        detail = (retry.stderr.strip() if retry is not None else "") or "git commit failed"
        raise BootstrapError(detail)


def _write_gitignore(root: Path, extra_ignores: list[str]) -> bool:
    """Writes `.gitignore` only when absent; returns whether it created one."""
    path = root / ".gitignore"
    if path.exists():
        return False
    lines = list(BASE_IGNORES) + [entry for entry in extra_ignores if entry not in BASE_IGNORES]
    path.write_text("\n".join(lines) + "\n")
    return True


def _effective_ignores(root: Path) -> list[str]:
    """The user's own `.gitignore` when there is one, else the base set `initialize` would write."""
    try:
        return (root / ".gitignore").read_text().splitlines()
    except OSError:
        return list(BASE_IGNORES)


def _walk(root: Path) -> list[tuple[str, int]]:
    """Every file under root as (repo-relative, size), skipping only what is never committable."""
    found: list[tuple[str, int]] = []
    stack = [root]
    while stack:
        current = stack.pop()
        try:
            entries = list(current.iterdir())
        except OSError:
            continue
        for entry in entries:
            if entry.name in _ALWAYS_IGNORED:
                continue
            if entry.is_dir() and not entry.is_symlink():
                stack.append(entry)
                continue
            try:
                size = entry.stat().st_size
            except OSError:
                continue
            found.append((entry.relative_to(root).as_posix(), size))
    return found


def _heavy_ancestor(relative: str) -> str | None:
    """The dependency/build dir a path sits under, as the `.gitignore` entry excluding it."""
    parts = Path(relative).parts
    for index, part in enumerate(parts[:-1]):
        if part in _HEAVY_DIRS:
            return "/".join(parts[: index + 1]) + "/"
    return None


def _suspicious(files: list[tuple[str, int]], base: _IgnoreRules) -> list[dict]:
    """What the user should look at before it enters history, each pre-ticked for exclusion."""
    heavy_dirs: dict[str, int] = {}
    for relative, size in files:
        heavy = _heavy_ancestor(relative)
        if heavy is not None:
            heavy_dirs[heavy] = heavy_dirs.get(heavy, 0) + size
    entries: list[dict] = [
        _entry(directory, "dependency or build output — usually not committed", size, base)
        for directory, size in sorted(heavy_dirs.items())
    ]
    for relative, size in sorted(files):
        if _heavy_ancestor(relative) is not None:
            continue
        name = Path(relative).name
        if any(fnmatch.fnmatch(name, glob) for glob in _SECRET_GLOBS):
            reason = "may contain credentials or private keys"
        elif size > large_file_bytes():
            reason = "larger than 5 MB"
        else:
            continue
        entries.append(_entry(relative, reason, size, base))
    return entries


def _entry(path: str, reason: str, size: int, base: _IgnoreRules) -> dict:
    """One suspicious row; `already_ignored` lets the dialog say the exclusion is nothing new."""
    return {
        "path": path,
        "reason": reason,
        "size": size,
        "preticked": True,
        "already_ignored": base.ignores(path.rstrip("/"), is_dir=path.endswith("/")),
    }


class _IgnoreRules:
    """A focused `.gitignore` matcher: comments, negation, dir-only, anchored and basename globs."""

    def __init__(self, lines: list[str]) -> None:
        self._rules: list[tuple[bool, str, bool, bool]] = []
        for raw in lines:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            negate = line.startswith("!")
            pattern = line[1:] if negate else line
            dir_only = pattern.endswith("/")
            pattern = pattern.rstrip("/")
            anchored = pattern.startswith("/") or "/" in pattern
            self._rules.append((negate, pattern.lstrip("/"), dir_only, anchored))

    def ignores(self, relative: str, is_dir: bool = False) -> bool:
        """Whether git would ignore this path, counting a rule that excludes any ancestor of it."""
        parts = Path(relative).parts
        for depth in range(1, len(parts) + 1):
            candidate = "/".join(parts[:depth])
            if self._matches(candidate, is_dir=is_dir or depth < len(parts)):
                return True
        return False

    def _matches(self, relative: str, is_dir: bool) -> bool:
        """One path against every rule; the last matching rule wins, as in git itself."""
        matched = False
        name = Path(relative).name
        for negate, pattern, dir_only, anchored in self._rules:
            if dir_only and not is_dir:
                continue
            target = relative if anchored else name
            if fnmatch.fnmatch(target, pattern):
                matched = not negate
        return matched
