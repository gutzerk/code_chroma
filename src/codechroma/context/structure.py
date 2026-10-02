"""Builds a bounded folder/file tree with real graph node ids, for an AI assistant to copy paths.

An agent authoring the C1 diagram's `children` trees needs repo-relative paths that actually resolve
to graph nodes. The `/nodes/{id}/children` route can't serve that need — it returns the full text of
every file child — so this module walks the same hierarchy and emits ids, paths and one-line
summaries only, under an explicit node budget.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

from codechroma.config import settings
from codechroma.engine import ROOT_SENTINEL, GraphEngine
from codechroma.errors import codechromaError
from codechroma.graph.models import (
    FILESYSTEM_LEVELS,
    HierarchyLevel,
    HierarchyNode,
    filesystem_order,
)

ROOT_ALIASES = ("", "root", ROOT_SENTINEL)


def _default_depth() -> int:
    return settings.structure.default_depth


def _default_max_children() -> int:
    return settings.structure.default_max_children


def _default_max_nodes() -> int:
    return settings.structure.default_max_nodes


class UnknownRootError(codechromaError, ValueError):
    """Raised when a requested structure root has no node in the current graph."""


@dataclass
class _Budget:
    """Remaining node allowance plus whether anything was cut anywhere in this walk."""

    remaining: int
    truncated: bool = field(default=False)


def build_structure(
    engine: GraphEngine,
    root_id: str = "root",
    depth: int | None = None,
    max_children: int | None = None,
    max_nodes: int | None = None,
) -> dict:
    """A depth- and budget-bounded folder/file tree under root_id, each entry carrying a node id."""
    depth = _clamp(depth if depth is not None else _default_depth(), settings.structure.max_depth)
    max_children = _clamp(
        max_children if max_children is not None else _default_max_children(),
        settings.structure.max_children,
    )
    budget = _Budget(
        remaining=_clamp(
            max_nodes if max_nodes is not None else _default_max_nodes(),
            settings.structure.max_nodes,
        )
    )
    parent_id = _resolve_root(engine, root_id)
    nodes = _walk(engine, _visible_children(engine, parent_id), depth, max_children, budget)
    return {"root": root_id, "depth": depth, "truncated": budget.truncated, "nodes": nodes}


def _clamp(value: int, cap: int) -> int:
    return max(1, min(int(value), cap))


def _resolve_root(engine: GraphEngine, root_id: str) -> str:
    if root_id in ROOT_ALIASES:
        return ROOT_SENTINEL
    if engine.get_node(root_id) is None:
        raise UnknownRootError(f"no graph node for root {root_id!r}")
    return root_id


def _walk(
    engine: GraphEngine,
    roots: list[HierarchyNode],
    depth: int,
    max_children: int,
    budget: _Budget,
) -> list[dict]:
    """Breadth-first so a spent budget costs depth rather than whole branches."""
    top = _take(engine, None, roots, max_children, budget)
    queue = deque((entry, node, 1) for entry, node in top)
    while queue:
        entry, node, level = queue.popleft()
        if node.level == HierarchyLevel.COMPONENT:
            continue
        children = _visible_children(engine, node.id)
        entry["child_count"] = len(children)
        if not children:
            continue
        if level >= depth:
            entry["truncated"] = budget.truncated = True
            continue
        taken = _take(engine, entry, children, max_children, budget)
        if taken:
            entry["children"] = [child_entry for child_entry, _ in taken]
        queue.extend((child_entry, child, level + 1) for child_entry, child in taken)
    return [entry for entry, _ in top]


def _take(
    engine: GraphEngine,
    parent: dict | None,
    nodes: list[HierarchyNode],
    max_children: int,
    budget: _Budget,
) -> list[tuple[dict, HierarchyNode]]:
    """Entries for as many of `nodes` as the caps allow, flagging `parent` if any were dropped."""
    taken = []
    for node in nodes[:max_children]:
        if budget.remaining == 0:
            break
        budget.remaining -= 1
        taken.append((_entry(engine, node), node))
    if len(taken) < len(nodes):
        budget.truncated = True
        if parent is not None:
            parent["truncated"] = True
    return taken


def _entry(engine: GraphEngine, node: HierarchyNode) -> dict:
    """`child_count`/`truncated` start empty and are filled in by _walk once the node is visited."""
    is_file = node.level == HierarchyLevel.COMPONENT
    return {
        "node_id": node.id,
        "path": node.source_path or node.name,
        "name": node.name,
        "level": "file" if is_file else "folder",
        "summary": _short_summary(engine, node.id),
        "doc_only": node.doc_only,
        "child_count": 0,
        "truncated": False,
    }


def _visible_children(engine: GraphEngine, node_id: str) -> list[HierarchyNode]:
    """Folders first, then files, each alphabetical — a stable order the agent can read down."""
    children = (child for child in engine.get_children(node_id) if child.level in FILESYSTEM_LEVELS)
    return sorted(children, key=filesystem_order)


def _short_summary(engine: GraphEngine, node_id: str) -> str | None:
    """First sentence only — enough to name a block from, without paying for the whole summary."""
    summary = engine.get_summary(node_id)
    if summary is None or not summary.text.strip():
        return None
    head = summary.text.strip().split(". ", 1)[0].rstrip(".")
    return f"{head}."[: settings.structure.summary_chars]
