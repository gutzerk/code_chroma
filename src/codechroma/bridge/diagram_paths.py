"""One spelling of an authored repo path, plus resolving it to a real graph node -- shared by every
path-based consumer (c1, custom, `c1_plan`'s file attribution). `overlays.resolve_impact_changes`
attributes by real `node_id`/ancestor walk instead, since impact boxes carry no authored path.

037-total-diagram-unification: merges `c1_resolver.py` + `c1_tree.py` -- no c1-specific logic was
left in either after 036 flattened every type's authored shape to `nodes[]` + `parent`; the "c1"
name was a historical accident, not a scope boundary.
"""

from __future__ import annotations

from codechroma.engine import GraphEngine

__all__ = ["clean_path", "resolve_path_node"]


def clean_path(path: object) -> str | None:
    """One spelling of an authored path, so resolving it and covering with it can never disagree."""
    if not isinstance(path, str):
        return None
    cleaned = path.strip().removeprefix("./").strip("/")
    return cleaned or None


def resolve_path_node(engine: GraphEngine, path: object) -> str | None:
    """Exact match only — a stale path stays unresolved rather than falling back to an ancestor."""
    clean = clean_path(path)
    if clean is None:
        return None
    for candidate in (f"component::{clean}", f"dir::{clean}"):
        if engine.get_node(candidate) is not None:
            return candidate
    return None
