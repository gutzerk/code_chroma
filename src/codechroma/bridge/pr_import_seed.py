"""Seed a freshly-fetched pull-request worktree with its repo's authored diagrams.

A PR's worktree is a bare checkout: its `.codechroma/` holds none of the diagrams the user already
made on `main`. Without this, opening a PR shows "you don't have any" for Patterns and Custom (and
an empty Epics view) even though `main` has them. C1 already borrows main read-through via
`c1_source_root`; here we go further and *copy* every diagram kind main has into the PR worktree, so
the PR is self-contained and stable even if main's diagrams change while it stays open.

Best-effort like `bootstrap_if_missing`: a diagram main never generated, or an I/O error, is
skipped, never a failure of the PR import.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from codechroma.bridge.diagram_registry import DIAGRAMS
from codechroma.bridge.epics_resolver import resolve_source_uri
from codechroma.bridge.plan_resolver import ROOT_NODE_ID
from codechroma.canvas.document import ensure_seeded
from codechroma.config import settings


def seed_diagrams_from_main(pr_root: Path, main_root: Path) -> None:
    """Best-effort copies main's authored diagrams and requirements into a fresh PR worktree."""
    if main_root == pr_root:
        return
    _copy_authored_diagram(pr_root, main_root, DIAGRAMS["c1"].artifact_path)
    for kind in DIAGRAMS.values():
        # "c1" is handled above via _copy_authored_diagram; every other kind copies its artifact.
        if kind.kind == "c1":
            continue
        _copy_artifact_if_missing(pr_root, main_root, kind.artifact_path)
    seed_canvas_doc(pr_root, main_root)
    _copy_projections(pr_root, main_root)
    _copy_custom_dir(pr_root, main_root)
    # No _copy_feature_plan_dir: unlike Patterns/Custom, it's per-task and on-demand, not standing.
    _copy_requirements_source(pr_root, main_root)


def _copy_artifact_if_missing(pr_root: Path, main_root: Path, artifact_path: object) -> None:
    """Copies a kind's artifact from main to the PR, only when the PR doesn't already have one."""
    resolve = artifact_path if callable(artifact_path) else None
    if resolve is None:
        return
    _copy_file_if_missing(resolve(main_root), resolve(pr_root))


def _copy_authored_diagram(pr_root: Path, main_root: Path, path_fn) -> None:
    """Copies a diagram kind's artifact from main (C1's explicit-path variant)."""
    _copy_file_if_missing(path_fn(main_root), path_fn(pr_root))


# 🔴 Public and idempotent: `prs.manager.reconcile()` calls this alone, never the whole seed above.
def seed_canvas_doc(pr_root: Path, main_root: Path) -> None:
    """Copies main's canvas-core.json, falling back to a seeded one -- a read-only PR can't seed."""
    if main_root == pr_root:
        return
    target = pr_root / ".codechroma" / "canvas-core.json"
    _copy_file_if_missing(main_root / ".codechroma" / "canvas-core.json", target)
    # Main may have none at all, and a PR opening on an empty document renders nothing whatsoever.
    ensure_seeded(target, pr_root / ".codechroma" / "diagrams", ROOT_NODE_ID)


def _copy_projections(pr_root: Path, main_root: Path) -> None:
    """Every diagram's own projection.json main has, copied into the PR alongside its artifact."""
    main_diagrams = main_root / ".codechroma" / "diagrams"
    if not main_diagrams.is_dir():
        return
    try:
        files = [entry for entry in main_diagrams.rglob("projection.json") if entry.is_file()]
    except OSError:
        return
    for source in files:
        relative = source.relative_to(main_diagrams)
        _copy_file_if_missing(source, pr_root / ".codechroma" / "diagrams" / relative)


def _copy_custom_dir(pr_root: Path, main_root: Path) -> None:
    """Every saved custom type's own artifact file (projections already copied above)."""
    main_custom = DIAGRAMS.custom_dir(main_root)
    if not main_custom.is_dir():
        return
    try:
        files = [
            entry
            for entry in main_custom.rglob("*")
            if entry.is_file() and entry.name != "projection.json"
        ]
    except OSError:
        return
    for source in files:
        relative = source.relative_to(main_custom)
        _copy_file_if_missing(source, DIAGRAMS.custom_dir(pr_root) / relative)


def _copy_requirements_source(pr_root: Path, main_root: Path) -> None:
    """Copies the configured requirements/delivery source dir, when it lives inside main."""
    config = settings.requirements
    for uri in (config.requirements_source_uri, config.delivery_source_uri):
        source = _resolved(uri, main_root)
        if source is None or not _inside(source, main_root) or not source.is_dir():
            continue
        target = _resolved(uri, pr_root)
        assert target is not None  # same uri as source above; _resolved's early-returns ignore root
        try:
            shutil.copytree(source, target, dirs_exist_ok=True)
        except OSError:
            # A PR with none of the source present is fine; the Epics view just shows empty.
            pass


def _copy_file_if_missing(source: Path, target: Path) -> None:
    """Copies `source` to `target` iff source exists and target does not; never raises."""
    try:
        if source.is_file() and not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
    except OSError:
        pass


def _resolved(uri: str, root: Path) -> Path | None:
    """epics_resolver.resolve_source_uri, but only for an explicit/default file:// scheme."""
    if "://" in uri and not uri.startswith("file://"):
        return None
    if not uri.removeprefix("file://"):
        return None
    return resolve_source_uri(uri, root)


def _inside(path: Path, root: Path) -> bool:
    """Whether `path` is within `root` (inclusive) -- so an external dir is never copied in."""
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False
