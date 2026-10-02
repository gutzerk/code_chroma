"""Finds the repo code no authored C1 block covers, so nothing on disk is missing from the diagram.

The C1 decomposition is curated — an agent names the blocks that matter and stops. That left a hole:
a directory nobody named was not merely unnamed, it was unreachable. `_attach_unmapped` in
c1_resolver only builds a "+N more" remainder for a block that has both a path and children, and the
system box has no path, so the top level never had one. This module closes it deterministically:
`uncovered_roots` returns the minimal set of subtrees no block's path accounts for, which the canvas
hangs off the system box as one "Unmapped code" block. Every file is therefore reachable from the
diagram whether or not the agent modelled it, and a directory added later is covered with no rerun.

Both entry points read one `_FileTree`, built in a single sweep of the graph, because
`engine.get_children` is a full node scan per call — the obvious per-directory recursion is
O(directories x nodes). `coverage_report` adds file counts on top of `uncovered_roots`, taken from
that same sweep rather than by subtracting the entry list, so a capped list can't overstate
coverage.

The two entry points scope differently on purpose. `uncovered_roots` stays whole-repo, because it
feeds the canvas and reachability is the promise. `coverage_report` drops dot-directories
(`.idea`, `.claude`, `.github`, …), because it feeds a percentage an agent is judged against and
nobody should ever spend an architecture block on IDE config.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from codechroma.engine import ROOT_SENTINEL, GraphEngine
from codechroma.graph.models import (
    FILESYSTEM_LEVELS,
    HierarchyLevel,
    HierarchyNode,
    filesystem_order,
)

# A runaway guard, not a display budget — rows only render once the block is expanded.
MAX_UNMAPPED_ROOTS = 200

__all__ = [
    "MAX_UNMAPPED_ROOTS",
    "Uncovered",
    "coverage_report",
    "covers",
    "uncovered_roots",
    "within",
]


@dataclass(slots=True)
class Uncovered:
    """The minimal uncovered subtrees, plus whether the cap cut the list short."""

    entries: list[dict] = field(default_factory=list)
    truncated: bool = False


def within(path: str, owner: str) -> bool:
    """True when `path` is `owner` itself or sits inside it — the repo's one containment rule."""
    return path == owner or path.startswith(f"{owner}/")


class _HasPath(Protocol):
    path: str | None


def deepest_owner[Block: _HasPath](path: str, blocks: list[Block]) -> Block | None:
    """The block whose path is the longest prefix of `path` — the most specific one wins."""
    best: Block | None = None
    for block in blocks:
        own = block.path or ""
        if not within(path, own):
            continue
        if best is None or len(own) > len(best.path or ""):
            best = block
    return best


def covers(path: str, paths: set[str]) -> bool:
    """True when a block names this path or an ancestor of it — the canvas drills down from it."""
    return any(within(path, owner) for owner in paths)


def uncovered_roots(
    engine: GraphEngine, paths: set[str], limit: int = MAX_UNMAPPED_ROOTS
) -> Uncovered:
    """The shallowest subtrees none of `paths` covers — the diagram's blind spots, deduped."""
    return _uncovered(_FileTree(engine), paths, limit)


def coverage_report(
    engine: GraphEngine, paths: set[str], limit: int = MAX_UNMAPPED_ROOTS
) -> dict:
    """How much of the repo the authored blocks account for, counted in files rather than blocks."""
    tree = _FileTree(engine)
    found = _uncovered(tree, paths, limit)
    # Dot-directories are scored out of both sides, so the entries still sum to unmapped_files.
    files = [path for path in tree.file_paths if not _is_config_path(path)]
    entries = [entry for entry in found.entries if not _is_config_path(entry["path"])]
    total_files = len(files)
    # Counted off the graph, not by subtracting entries: a truncated list can't overstate coverage.
    covered_files = sum(1 for path in files if covers(path, paths))
    return {
        "total_files": total_files,
        "covered_files": covered_files,
        "unmapped_files": total_files - covered_files,
        "percent": _percent(covered_files, total_files),
        "entries": _with_file_counts(entries, files),
        "truncated": found.truncated,
    }


def _is_config_path(path: str) -> bool:
    """True for anything under a dot-directory — tool and IDE config, never architecture."""
    return any(segment.startswith(".") for segment in path.split("/"))


def _percent(covered: int, total: int) -> int:
    """Floored, not rounded: one uncovered file out of 418 must never read back as 100%."""
    if not total:
        return 100
    return covered * 100 // total


class _FileTree:
    """The graph's filesystem layer, indexed in one sweep — get_children is a full scan per call."""

    __slots__ = ("children", "file_paths")

    def __init__(self, engine: GraphEngine) -> None:
        self.children: dict[str, list[HierarchyNode]] = {}
        self.file_paths: list[str] = []
        for node in engine.snapshot().nodes.values():
            if node.level not in FILESYSTEM_LEVELS or not node.source_path:
                continue
            if node.level == HierarchyLevel.COMPONENT:
                self.file_paths.append(node.source_path)
            # A node with no parents is what get_children reports under the root sentinel.
            for parent_id in node.parent_ids or [ROOT_SENTINEL]:
                self.children.setdefault(parent_id, []).append(node)
        for siblings in self.children.values():
            siblings.sort(key=filesystem_order)

    def of(self, node_id: str) -> list[HierarchyNode]:
        return self.children.get(node_id, [])


def _uncovered(tree: _FileTree, paths: set[str], limit: int) -> Uncovered:
    found = Uncovered()
    _walk(tree, ROOT_SENTINEL, paths, found, limit)
    return found


def _walk(tree: _FileTree, node_id: str, paths: set[str], found: Uncovered, limit: int) -> None:
    """Descends only where coverage is partial: covered or wholly uncovered ends the branch."""
    for child in tree.of(node_id):
        if found.truncated:
            return
        path = child.source_path or ""
        if covers(path, paths):
            continue
        if _has_covered_descendant(path, paths):
            _walk(tree, child.id, paths, found, limit)
            continue
        if len(found.entries) >= limit:
            found.truncated = True
            return
        found.entries.append(_entry(child, path))


def _entry(node: HierarchyNode, path: str) -> dict:
    return {
        "node_id": node.id,
        "path": path,
        "name": node.name,
        "level": "file" if node.level == HierarchyLevel.COMPONENT else "folder",
    }


def _has_covered_descendant(path: str, paths: set[str]) -> bool:
    """True when a block names something inside this directory, so only part of it is missing."""
    return any(covered.startswith(f"{path}/") for covered in paths)


def _with_file_counts(entries: list[dict], file_paths: list[str]) -> list[dict]:
    """Charges each file to the deepest entry holding it — one pass counts every subtree at once."""
    counted = [{**entry, "file_count": 0} for entry in entries]
    by_path = {entry["path"]: entry for entry in counted}
    for path in file_paths:
        owner = _owning_entry(path, by_path)
        if owner is not None:
            owner["file_count"] += 1
    return counted


def _owning_entry(path: str, by_path: dict[str, dict]) -> dict | None:
    """The entry a file sits under, found by walking its ancestors — None when no entry holds it."""
    candidate = path
    while candidate:
        entry = by_path.get(candidate)
        if entry is not None:
            return entry
        candidate = candidate.rpartition("/")[0]
    return None
