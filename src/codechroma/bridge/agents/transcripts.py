"""Finds the Claude Code session id for a worktree, so `claude --resume` continues its chat.

🔴 The directory name Claude Code derives from a project path is *not* guessed here. Guessing the
escaping wrong would make Resume silently start a fresh conversation — the worst possible failure,
since it looks like it worked. Instead every transcript records its own `cwd`, so the id comes
from the newest transcript whose `cwd` is this worktree, whatever its directory is called.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from codechroma.config import settings


def max_scanned_transcripts() -> int:
    # Bounded so years of transcripts still answer quickly; newest are scanned first.
    return settings.transcripts.max_scanned_transcripts


def head_lines() -> int:
    # `cwd` appears within the first few entries of a transcript; no need to read a multi-MB file.
    return settings.transcripts.head_lines


def projects_dir() -> Path:
    """`$CLAUDE_CONFIG_DIR/projects`, else `~/.claude/projects` — the override the CLI honours."""
    configured = os.environ.get("CLAUDE_CONFIG_DIR", "").strip()
    base = Path(configured).expanduser() if configured else Path.home() / ".claude"
    return base / "projects"


def find_session_id(
    worktree: Path, projects_root: Path | None = None, exclude: frozenset[str] = frozenset()
) -> str | None:
    """Newest transcript's session id for this worktree, skipping ids a sibling already claimed."""
    root = projects_root if projects_root is not None else projects_dir()
    target = str(Path(worktree).resolve())
    for path in _transcripts_newest_first(root):
        session_id = _session_id_for_cwd(path, target)
        if session_id is not None and session_id not in exclude:
            return session_id
    return None


def _transcripts_newest_first(root: Path) -> list[Path]:
    try:
        candidates = list(root.glob("*/*.jsonl"))
    except OSError:
        return []
    stamped: list[tuple[float, Path]] = []
    for path in candidates:
        try:
            stamped.append((path.stat().st_mtime, path))
        except OSError:
            continue
    stamped.sort(key=lambda item: item[0], reverse=True)
    return [path for _mtime, path in stamped[:max_scanned_transcripts()]]


def _session_id_for_cwd(path: Path, target: str) -> str | None:
    """This transcript's session id if it was recorded in `target`, else None."""
    try:
        with path.open() as handle:
            for index, line in enumerate(handle):
                if index >= head_lines():
                    return None
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(entry, dict) or "cwd" not in entry:
                    continue
                if str(entry.get("cwd")) != target:
                    return None
                session_id = entry.get("sessionId")
                return session_id if isinstance(session_id, str) and session_id else path.stem
    except OSError:
        return None
    return None
