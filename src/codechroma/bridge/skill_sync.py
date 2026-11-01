"""Installs codechroma skills into the analyzed repo so agents there write canvas artifacts."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path

from codechroma.bridge.git_cmd import ensure_excluded
from codechroma.bridge.resources import resource_path
from codechroma.llm.cli_adapters import KIMI_MCP_CONFIG
from codechroma.skills import SKILL_TARGET_PARTS

__all__ = [
    "RETIRED_SKILL_NAMES",
    "SKILL_EXCLUDE_PATTERNS",
    "SKILL_NAMES",
    "WORKTREE_EXCLUDES",
    "install_into_worktree",
    "prune_retired_skills",
    "skill_source",
    "sync_all_skills",
    "sync_skill",
]

# The single per-skill list: a new skill is one name here (plus its directory under skills/).
SKILL_NAMES = (
    "codechroma-draw-diagram",
    "codechroma-review-diagram",
    "codechroma-epic-brief",
    "codechroma-wiki-general-update",
    "codechroma-grill",
    "codechroma-decision-diagram",
)

# 🔴 Merged/retired away, but still installed in repos an earlier version analyzed -- prune below.
RETIRED_SKILL_NAMES = (
    "codechroma-c1",
    "codechroma-patterns",
    "codechroma-impact",
    "codechroma-custom-diagram",
    "codechroma-c1-review",
    "codechroma-impact-review",
    "codechroma-plan",
    # research feature removed wholesale; prune any skill an earlier version installed.
    "codechroma-research",
    # 058: the deterministic pipeline (run_body) replaced this skill's self-orchestrating claude -p.
    "codechroma-wiki-general",
    # diagram-management unification: the in-app custom-diagram-type interview is retired.
    "codechroma-diagram-type",
)


def skill_source(name: str) -> Path:
    """Where the packaged copy of a skill lives inside this installation."""
    return resource_path("skills", name)


def skill_relative_paths(name: str) -> tuple[Path, ...]:
    """Where a skill is installed inside an analyzed repo, relative to its root, one per target."""
    return tuple(Path(*parts) / name for parts in SKILL_TARGET_PARTS)


# Feed to git_cmd.ensure_excluded: a synced copy (retired ones too) or an agent's Kimi MCP file.
SKILL_EXCLUDE_PATTERNS = (
    *(
        f"{relative.as_posix()}/"
        for name in (*SKILL_NAMES, *RETIRED_SKILL_NAMES)
        for relative in skill_relative_paths(name)
    ),
    KIMI_MCP_CONFIG,
)

# Every path a fresh agent/PR worktree must never show as its own uncommitted work.
WORKTREE_EXCLUDES = (".codechroma/", *SKILL_EXCLUDE_PATTERNS)


def sync_skill(repo_root: Path, name: str, source: Path | None = None) -> list[Path]:
    """Copies a skill into each repo_root/<target>, replacing any stale copy; returns the copies."""
    resolved_source = source if source is not None else skill_source(name)
    if not resolved_source.is_dir():
        return []
    installed = []
    for relative in skill_relative_paths(name):
        target = repo_root / relative
        if target.resolve() == resolved_source.resolve():
            continue
        if target.exists():
            shutil.rmtree(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(resolved_source, target)
        installed.append(target)
    return installed


def prune_retired_skills(repo_root: Path) -> list[Path]:
    """Removes skills a previous version installed, so a merged-away name can't linger forever."""
    removed = []
    for name in RETIRED_SKILL_NAMES:
        for relative in skill_relative_paths(name):
            target = repo_root / relative
            if not target.is_dir():
                continue
            shutil.rmtree(target, ignore_errors=True)
            removed.append(target)
    return removed


def sync_all_skills(repo_root: Path) -> None:
    """Installs every codechroma-* skill into repo_root -- the one call each entry point makes."""
    for name in SKILL_NAMES:
        sync_skill(repo_root, name)
    prune_retired_skills(repo_root)


def install_into_worktree(root: Path, log_prefix: str) -> None:
    """A fresh agent/PR worktree never reaches the launcher's own sync, so this does it directly."""
    ensure_excluded(root, WORKTREE_EXCLUDES)
    try:
        sync_all_skills(root)
    except OSError:
        logging.getLogger("uvicorn.error").exception(
            "%s: could not install skills into %s", log_prefix, root
        )
