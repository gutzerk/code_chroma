"""Commits one diffed node's change to git, staging only its overlapping hunks."""

from __future__ import annotations

import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path

from codechroma.analyzers.registry import AnalyzerRegistry
from codechroma.bridge.git_cmd import detect_git_root, run_git, run_git_or_raise
from codechroma.bridge.git_diff import old_symbols
from codechroma.engine import GraphEngine
from codechroma.errors import codechromaError

_COMPONENT_PREFIX = "component::"
_HUNK_HEADER_RE = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


class GitAcceptError(codechromaError):
    """Base for accept-diff failures; message is safe to return to the API caller."""


class DiffNotFoundError(GitAcceptError):
    """No pending git change matches this node_id."""


class GitConflictError(GitAcceptError):
    """The patch could not be applied, most likely because the file changed since diffing."""


class GitCommandError(GitAcceptError):
    """A git subprocess exited non-zero unexpectedly."""


@dataclass(slots=True)
class AcceptResult:
    """The outcome of successfully accepting a diffed node: which file, and the resulting commit."""

    file_path: str
    commit_sha: str


@dataclass(slots=True)
class _Hunk:
    """One `@@ ... @@` hunk from a unified diff, kept as raw lines for verbatim reassembly."""

    old_start: int
    new_start: int
    lines: list[str]


def accept_diff(engine: GraphEngine, repo_root: Path, node_id: str) -> AcceptResult:
    """Commits node_id's pending change: hunk-filtered for a present file, whole-file otherwise."""
    repo_root = repo_root.resolve()
    git_root = detect_git_root(repo_root)
    if git_root is None:
        raise DiffNotFoundError("not a git repository")

    file_path = _file_path_from_node_id(node_id)
    abs_path = repo_root / file_path
    git_relative = _git_relative(repo_root, git_root, file_path)

    if not abs_path.exists():
        message = f"Accept deletion of {file_path}"
        return _accept_whole_file(git_root, git_relative, file_path, message)

    if not _is_tracked(git_root, git_relative):
        message = f"Accept new file: {file_path}"
        return _accept_whole_file(git_root, git_relative, file_path, message)

    old_range, new_range = _resolve_ranges(engine, repo_root, git_root, node_id, file_path)
    if old_range is None and new_range is None:
        raise DiffNotFoundError(f"no pending change for {node_id}")

    diff_text = _run_git_required(git_root, "diff", "HEAD", "--", git_relative)
    if not diff_text.strip():
        raise DiffNotFoundError(f"no pending change for {node_id}")

    header, hunks = _split_diff(diff_text)
    patch = _build_patch(header, hunks, old_range, new_range)
    if patch is None:
        return _accept_whole_file(git_root, git_relative, file_path, f"Accept diff: {file_path}")

    sha = _commit_patch(git_root, git_relative, patch, _commit_message(node_id, file_path))
    return AcceptResult(file_path=file_path, commit_sha=sha)


def _resolve_ranges(
    engine: GraphEngine, repo_root: Path, git_root: Path, node_id: str, file_path: str
) -> tuple[tuple[int, int] | None, tuple[int, int] | None]:
    """(old_range, new_range) spans for node_id, whichever side currently/previously existed."""
    new_symbol = engine.get_symbol(node_id)
    new_range = (new_symbol.start_line, new_symbol.end_line) if new_symbol is not None else None

    old_symbol = None
    registry = AnalyzerRegistry.with_defaults()
    analyzer = registry.for_file(file_path)
    if analyzer is not None:
        old_by_id, old_containers_by_id, _old_text, _existed = old_symbols(
            analyzer, git_root, repo_root, file_path
        )
        old_symbol = old_by_id.get(node_id) or old_containers_by_id.get(node_id)
    old_range = (old_symbol.start_line, old_symbol.end_line) if old_symbol is not None else None
    return old_range, new_range


def _file_path_from_node_id(node_id: str) -> str:
    """Recovers the repo-relative file path a node_id refers to, across every id shape it emits."""
    if node_id.startswith(_COMPONENT_PREFIX):
        return node_id[len(_COMPONENT_PREFIX) :]
    return node_id.split("::", 1)[0]


def _git_relative(repo_root: Path, git_root: Path, file_path: str) -> str:
    prefix = repo_root.relative_to(git_root).as_posix()
    return file_path if prefix in ("", ".") else f"{prefix}/{file_path}"


def _is_tracked(git_root: Path, git_relative: str) -> bool:
    output = run_git(git_root, "ls-files", "--", git_relative)
    return bool((output or "").strip())


def _split_diff(diff_text: str) -> tuple[list[str], list[_Hunk]]:
    """Splits `git diff` output into its leading file-header lines and each `@@` hunk's raw lines"""
    header: list[str] = []
    hunks: list[_Hunk] = []
    current: list[str] | None = None
    for line in diff_text.splitlines(keepends=True):
        if _HUNK_HEADER_RE.match(line):
            if current is not None:
                hunks.append(_finish_hunk(current))
            current = [line]
        elif current is not None:
            current.append(line)
        else:
            header.append(line)
    if current is not None:
        hunks.append(_finish_hunk(current))
    return header, hunks


def _finish_hunk(lines: list[str]) -> _Hunk:
    match = _HUNK_HEADER_RE.match(lines[0])
    assert match is not None
    return _Hunk(int(match.group(1)), int(match.group(3)), lines)


def _build_patch(
    header: list[str],
    hunks: list[_Hunk],
    old_range: tuple[int, int] | None,
    new_range: tuple[int, int] | None,
) -> str | None:
    """Rewrites every hunk down to just this node's own lines; None if nothing of it survives."""
    body: list[str] = []
    for hunk in hunks:
        rewritten = _rewrite_hunk(hunk, old_range, new_range)
        if rewritten is not None:
            body.extend(rewritten)
    if not body:
        return None
    return "".join(header + body)


def _rewrite_hunk(
    hunk: _Hunk, old_range: tuple[int, int] | None, new_range: tuple[int, int] | None
) -> list[str] | None:
    """Folds every +/- line outside old_range/new_range back to context; None if none remain."""
    old_line, new_line = hunk.old_start, hunk.new_start
    out: list[str] = [hunk.lines[0]]
    for raw in hunk.lines[1:]:
        marker = raw[:1]
        if marker == "-":
            if old_range is not None and old_range[0] <= old_line <= old_range[1]:
                out.append(raw)
            else:
                out.append(" " + raw[1:])
                new_line += 1
            old_line += 1
        elif marker == "+":
            if new_range is not None and new_range[0] <= new_line <= new_range[1]:
                out.append(raw)
            new_line += 1
        else:
            out.append(raw)
            old_line += 1
            new_line += 1
    if not any(line[:1] in ("+", "-") for line in out[1:]):
        return None
    return out


def _commit_message(node_id: str, file_path: str) -> str:
    name = node_id.rsplit("::", 1)[-1] if "::" in node_id else node_id
    return f"Accept diff: {name} ({file_path})"


def _accept_whole_file(
    git_root: Path, git_relative: str, file_path: str, message: str
) -> AcceptResult:
    """`git add` picks up creations, edits, and deletions alike for an explicit pathspec."""
    _run_git_required(git_root, "add", "--", git_relative)
    sha = _commit_path(git_root, git_relative, message)
    return AcceptResult(file_path=file_path, commit_sha=sha)


def _commit_patch(git_root: Path, git_relative: str, patch: str, message: str) -> str:
    """Commits HEAD-plus-patch via a throwaway index, then syncs the real index's entry to it."""
    head_sha = _run_git_required(git_root, "rev-parse", "HEAD").strip()
    with tempfile.TemporaryDirectory() as tmp_dir:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(tmp_dir) / "index")}
        _run_git_required(git_root, "read-tree", head_sha, env=env)
        try:
            _run_git_required(
                git_root, "apply", "--cached", "--recount", "-", env=env, input_text=patch
            )
        except GitCommandError as exc:
            raise GitConflictError(f"could not apply change, file may differ: {exc}") from exc
        tree_sha = _run_git_required(git_root, "write-tree", env=env).strip()
        commit_sha = _run_git_required(
            git_root, "commit-tree", tree_sha, "-p", head_sha, "-m", message, env=env
        ).strip()
        entry = _run_git_required(
            git_root, "ls-tree", tree_sha, "--", git_relative, env=env
        ).strip()
    _run_git_required(git_root, "update-ref", "HEAD", commit_sha)
    if entry:
        mode, _kind, blob_sha, *_rest = entry.split()
        cacheinfo = f"{mode},{blob_sha},{git_relative}"
        _run_git_required(git_root, "update-index", "--cacheinfo", cacheinfo)
    return commit_sha


def _commit_path(git_root: Path, git_relative: str, message: str) -> str:
    _run_git_required(git_root, "commit", "-m", message, "--", git_relative)
    return _run_git_required(git_root, "rev-parse", "HEAD").strip()


def _run_git_required(
    cwd: Path, *args: str, env: dict[str, str] | None = None, input_text: str | None = None
) -> str:
    """run_git's raising twin: accepting a diff must surface why git refused, not swallow it."""
    return run_git_or_raise(
        cwd, *args, error_cls=GitCommandError, env=env, input_text=input_text
    )
