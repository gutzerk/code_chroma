"""Detects on-disk edits via `git status` and triggers an incremental reanalyze for them, so
changes made outside the canvas (a text editor, another Claude session, git checkout) show up
without restarting the bridge server.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from codechroma.bridge.git_cmd import (
    detect_git_root,
    porcelain_paths,
    resolve_repo_relative,
    run_git,
)
from codechroma.engine import GraphEngine

logger = logging.getLogger("codechroma.bridge.git_sync")


class GitSync:
    """Diffs `git status --porcelain` against its last-seen output and reanalyzes what changed."""

    def __init__(self, repo_root: Path):
        self._repo_root = repo_root.resolve()
        self._git_root = detect_git_root(self._repo_root)
        self._lock = threading.Lock()
        self._last_signature: str | None = None
        # Seeded eagerly (not on first sync()) so bring-up never reads as a spurious "commit".
        self._last_head: str | None = self.current_head()

    def _ensure_git_root(self) -> bool:
        """Re-probes for a git root if none was found yet (e.g. `git init` ran since)."""
        if self._git_root is None:
            self._git_root = detect_git_root(self._repo_root)
        return self._git_root is not None

    def current_head(self) -> str | None:
        """`git rev-parse HEAD`, stripped; `None` off an unborn HEAD or a non-repo directory."""
        head = run_git(self._repo_root, "rev-parse", "HEAD")
        return head.strip() if head is not None else None

    def sync(self, engine: GraphEngine) -> list[str] | None:
        """Reanalyzes files git reports as changed since the last call; returns them, else None."""
        if not self._ensure_git_root():
            return None
        with self._lock:
            status = self._raw_status()
            if status is None:
                return None
            changed = self._changed_paths(status)
            # mtime-keyed: re-editing an already-"M path" file keeps the same status line.
            signature = self._signature(changed)
            if signature == self._last_signature:
                return None
            self._last_signature = signature
            if changed:
                engine.reanalyze(changed)
                return changed
            return []

    def head_changed(self) -> bool:
        """True once per HEAD move -- not just commit (checkout/merge/rebase/reset/pull too)."""
        if not self._ensure_git_root():
            return False
        with self._lock:
            head = self.current_head()
            if head is None or head == self._last_head:
                return False
            self._last_head = head
            return True

    def _raw_status(self) -> str | None:
        # git_cmd's shared timeout, not a private 2s one; a big repo's status must not go quiet.
        status = run_git(
            self._repo_root, "status", "--porcelain", "--untracked-files=all", "--", "."
        )
        if status is None:
            logger.warning(
                "git status failed or timed out in %s; live update skipped", self._repo_root
            )
        return status

    def _changed_paths(self, status: str) -> list[str]:
        assert self._git_root is not None  # sole caller (sync()) already returned early otherwise
        paths = []
        for raw in porcelain_paths(status):
            resolved = resolve_repo_relative(self._git_root, self._repo_root, raw)
            if resolved is None:
                continue
            _, rel = resolved
            # Skip our own .codechroma db: its mtime changes every reanalyze, which would self-loop.
            if ".codechroma" in Path(rel).parts:
                continue
            paths.append(rel)
        return paths

    def _signature(self, changed: list[str]) -> str:
        parts = []
        for rel in sorted(changed):
            try:
                mtime = (self._repo_root / rel).stat().st_mtime_ns
            except OSError:
                mtime = -1
            parts.append(f"{rel}:{mtime}")
        return "|".join(parts)
