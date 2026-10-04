"""Git subprocess primitives and working-tree status parsing, shared by git_diff and git_accept."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from codechroma.config import settings
from codechroma.llm.runtime_env import CliLookupError, launch_failed, resolve_runtime_cli


def _git_timeout() -> int:
    return settings.git.short_timeout_seconds


def run_git_raw(
    cwd: Path,
    *args: str,
    env: dict[str, str] | None = None,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str] | None:
    """The one place a git subprocess is spawned; None when git couldn't be run at all."""
    try:
        runtime = resolve_runtime_cli("git", env)
        return subprocess.run(
            [runtime.executable, *args],
            cwd=cwd,
            env=dict(runtime.env),
            input=input_text,
            capture_output=True,
            text=True,
            timeout=_git_timeout(),
        )
    except (OSError, subprocess.TimeoutExpired, CliLookupError) as exc:
        launch_failed(exc)
        return None


def run_git(cwd: Path, *args: str) -> str | None:
    """stdout of a git command, or None if it couldn't run or exited non-zero."""
    result = run_git_raw(cwd, *args)
    if result is None or result.returncode != 0:
        return None
    return result.stdout


def run_git_or_raise(
    cwd: Path,
    *args: str,
    error_cls: type[Exception],
    description: str | None = None,
    env: dict[str, str] | None = None,
    input_text: str | None = None,
) -> str:
    """run_git_raw's raising twin: raises `error_cls` with git's stderr, or a fallback message."""
    result = run_git_raw(cwd, *args, env=env, input_text=input_text)
    command = description or f"git {' '.join(args)}"
    if result is None:
        raise error_cls(f"{command} could not be run")
    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        detail = f": {stderr}" if stderr else f" exited {result.returncode}"
        raise error_cls(f"{command} failed{detail}")
    return result.stdout


def ensure_excluded(cwd: Path, patterns: tuple[str, ...] | list[str]) -> bool:
    """Adds patterns to the repository's `info/exclude`: local, untracked, shared, idempotent."""
    # --git-path resolves to the *common* git dir even from a worktree, so this covers them all.
    resolved = run_git(cwd, "rev-parse", "--git-path", "info/exclude")
    if resolved is None:
        return False
    path = Path(resolved.strip())
    if not path.is_absolute():
        path = (cwd / path).resolve()
    try:
        existing = path.read_text().splitlines() if path.exists() else []
        missing = [pattern for pattern in patterns if pattern not in existing]
        if not missing:
            return True
        path.parent.mkdir(parents=True, exist_ok=True)
        prefix = "" if not existing or existing[-1] == "" else "\n"
        with path.open("a") as handle:
            handle.write(prefix + "\n".join(missing) + "\n")
    except OSError:
        return False
    return True


def porcelain_paths(raw: str) -> list[str]:
    """Every path a `git status --porcelain` output names (a rename's new side), unquoted."""
    paths = []
    for line in raw.splitlines():
        if len(line) > 3:
            path = line[3:].split(" -> ")[-1].strip().strip('"')
            if path:
                paths.append(path)
    return paths


def detect_git_root(repo_root: Path) -> Path | None:
    result = run_git(repo_root, "rev-parse", "--show-toplevel")
    return Path(result.strip()).resolve() if result is not None else None


def resolve_repo_relative(
    git_root: Path, repo_root: Path, raw_path: str
) -> tuple[Path, str] | None:
    """Resolves raw_path against git_root and re-relativizes it to repo_root; None if outside it."""
    absolute = (git_root / raw_path).resolve()
    try:
        relative = absolute.relative_to(repo_root).as_posix()
    except ValueError:
        return None
    return absolute, relative


def head_content(git_root: Path, repo_root: Path, file_path: str, base: str = "HEAD") -> bytes:
    """`base`'s bytes for file_path, or b"" if it didn't exist there or there is no commit yet."""
    prefix = repo_root.relative_to(git_root).as_posix()
    git_relative = f"{prefix}/{file_path}" if prefix else file_path
    try:
        runtime = resolve_runtime_cli("git")
        result = subprocess.run(
            [runtime.executable, "show", f"{base}:{git_relative}"],
            cwd=git_root,
            env=dict(runtime.env),
            capture_output=True,
            timeout=_git_timeout(),
        )
    except (OSError, subprocess.TimeoutExpired, CliLookupError) as exc:
        launch_failed(exc)
        return b""
    return result.stdout if result.returncode == 0 else b""


@dataclass(slots=True)
class WorkingTreeStatus:
    """Repo-root-relative paths git reports as changed-and-present, and as deleted."""

    changed: list[str] = field(default_factory=list)
    deleted: list[str] = field(default_factory=list)
    # Per-path "added" | "modified" | "deleted", for callers that need the kind, not just the split.
    statuses: dict[str, str] = field(default_factory=dict)


def _status_kind(index_code: str, worktree_code: str, is_delete: bool) -> str:
    """Maps a porcelain XY pair to added/modified/deleted — untracked ("??") counts as added."""
    if is_delete:
        return "deleted"
    if "A" in (index_code, worktree_code) or (index_code, worktree_code) == ("?", "?"):
        return "added"
    return "modified"


def working_tree_status(
    repo_root: Path, git_root: Path, base: str = "HEAD"
) -> WorkingTreeStatus:
    """Everything that differs from `base`, split into present-and-changed vs deleted paths."""
    # "HEAD" keeps the original uncommitted-only path byte for byte; an agent needs its commits too.
    if base == "HEAD":
        return _uncommitted_status(repo_root, git_root)
    return _status_against(repo_root, git_root, base)


def _uncommitted_status(repo_root: Path, git_root: Path) -> WorkingTreeStatus:
    status = WorkingTreeStatus()
    raw = run_git(repo_root, "status", "--porcelain", "--untracked-files=all", "--", ".")
    if raw is None:
        return status
    for line in raw.splitlines():
        if len(line) < 4:
            continue
        is_delete = "D" in (line[0], line[1])
        kind = _status_kind(line[0], line[1], is_delete)
        # A rename reads "old -> new": the delete side is the old path, the change side the new one.
        raw_path = line[3:].split(" -> ")[0 if is_delete else -1].strip().strip('"')
        if not raw_path:
            continue
        resolved = resolve_repo_relative(git_root, repo_root, raw_path)
        if resolved is None:
            continue
        absolute, relative = resolved
        if is_delete:
            if not absolute.exists():
                status.deleted.append(relative)
                status.statuses[relative] = kind
        elif absolute.is_file():
            status.changed.append(relative)
            status.statuses[relative] = kind
    return status


def _status_against(repo_root: Path, git_root: Path, base: str) -> WorkingTreeStatus:
    """Working tree vs a commit: `git diff` covers tracked files, `status` the untracked ones."""
    status = WorkingTreeStatus()
    raw = run_git(repo_root, "diff", "--name-status", base, "--", ".")
    if raw is None:
        # An unreachable base gives nothing honest to diff against: report nothing, don't guess.
        return status
    for line in raw.splitlines():
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        code = parts[0][:1]
        # A rename reads "R100\told\tnew": the delete side is the old path, the change side the new.
        raw_path = parts[-1] if code != "D" else parts[1]
        _record(status, repo_root, git_root, raw_path, _diff_kind(code))
    untracked = run_git(repo_root, "status", "--porcelain", "--untracked-files=all", "--", ".")
    for line in (untracked or "").splitlines():
        if line[:2] == "??" and len(line) > 3:
            _record(status, repo_root, git_root, line[3:].strip().strip('"'), "added")
    return status


def _diff_kind(code: str) -> str:
    if code == "A":
        return "added"
    if code == "D":
        return "deleted"
    return "modified"


def _record(
    status: WorkingTreeStatus, repo_root: Path, git_root: Path, raw_path: str, kind: str
) -> None:
    """Adds one repo-root-relative path to the right bucket, skipping anything outside repo_root."""
    if not raw_path:
        return
    resolved = resolve_repo_relative(git_root, repo_root, raw_path)
    if resolved is None:
        return
    absolute, relative = resolved
    if relative in status.statuses:
        return
    if kind == "deleted" or not absolute.exists():
        if absolute.exists():
            return
        status.deleted.append(relative)
        status.statuses[relative] = "deleted"
    elif absolute.is_file():
        status.changed.append(relative)
        status.statuses[relative] = kind
