"""Resolves a (file, symbol) target to the nearest existing graph node.

Walks up the hierarchy function -> class -> file(component) -> nearest existing directory folder
and anchors to the nearest node that actually exists in the graph, so a target that names
not-yet-written code still lands somewhere. Shared by change_cards (git-derived changes) and
impact_context (feature-spec seeds); never copy this ladder.
"""

from __future__ import annotations

from pathlib import Path

from codechroma.engine import ROOT_SENTINEL, GraphEngine
from codechroma.graph.models import HierarchyNode

ROOT_NODE_ID = "root"


def resolve_target(engine: GraphEngine, file_path: str, symbol: str | None) -> tuple[str, str]:
    """Returns (node_id, resolution) for the nearest existing ancestor of (file_path, symbol)."""
    # Public because change_cards pins git-derived changes with the same ladder; never copy it.
    if symbol:
        exact = _first_existing(
            engine, [f"{file_path}::function::{symbol}", f"{file_path}::class::{symbol}"]
        )
        if exact is not None:
            return exact.id, "exact"
        if "." in symbol:
            class_id = f"{file_path}::class::{symbol.rsplit('.', 1)[0]}"
            parent_class = engine.get_node(class_id)
            if parent_class is not None:
                return parent_class.id, "parent"

    component = engine.get_node(f"component::{file_path}")
    if component is not None:
        return component.id, "parent" if symbol else "exact"

    for dir_path in _dir_chain(file_path):
        directory = engine.get_node(f"dir::{dir_path}")
        if directory is not None:
            return directory.id, "ancestor"

    return _root_fallback(engine), "ancestor"


def _first_existing(engine: GraphEngine, candidate_ids: list[str]) -> HierarchyNode | None:
    for candidate in candidate_ids:
        node = engine.get_node(candidate)
        if node is not None:
            return node
    return None


def _root_fallback(engine: GraphEngine) -> str:
    """A brand-new top-level dir has no folder node; anchor to any root node, else root."""
    systems = engine.get_children(ROOT_SENTINEL)
    return systems[0].id if systems else ROOT_NODE_ID


def _dir_chain(file_path: str) -> list[str]:
    """Ancestor directory paths of file_path, nearest (deepest) first."""
    parts = Path(file_path).parts[:-1]
    chain = ["/".join(parts[: i + 1]) for i in range(len(parts))]
    return list(reversed(chain))
