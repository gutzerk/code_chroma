"""Seeds a new agent worktree's diagram files from main, so it opens already drawn.

A fresh worktree is a checkout of main's current HEAD, so at the moment of creation its
architecture is identical to main's -- copying main's `.codechroma/{c1,patterns}.json`
into the new worktree is exactly as valid as main's own, and saves the first-open regeneration run.
Once the agent's branch diverges, its copy is independent: the existing stale/fingerprint check
already used for edits made after generation is what surfaces that, no special-casing needed here.
Layout files are not seeded (016 Stage 6) -- a box's position lives in canvas-core.json now.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from codechroma.bridge.diagram_registry import DIAGRAMS

__all__ = ["seed_diagrams_from_main"]


def seed_diagrams_from_main(main_root: Path, target_root: Path) -> None:
    """Copies each diagram's artifact file from main_root into target_root, if present."""
    for spec in DIAGRAMS.values():
        _copy_if_exists(spec.artifact_path(main_root), spec.artifact_path(target_root))


def _copy_if_exists(source: Path, target: Path) -> None:
    """Copies source onto target; no-op if main has no file, or target already has one."""
    # The target check makes this a safe backfill over existing agents (AgentManager.reconcile).
    if not source.is_file() or target.is_file():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
