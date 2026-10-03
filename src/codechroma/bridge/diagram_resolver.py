"""One resolver every diagram type shares: node/relation validation, path resolution, style order.

036-shared-diagram-style-catalog: replaces `resolve_c1`/`resolve_patterns`/`resolve_impact_diagram`/
`resolve_custom` -- those four took structurally different authored inputs (a nested tree, a
heuristic-candidate list, two already-flat shapes); once every type authors the one flat
`nodes[]`/`relations[]` shape (`contracts/diagram-schema.md`), one function can validate/resolve/
style all of them. A type's own business logic (patterns' heuristic/persisted merge, impact's
diff/plan slice derivation) still runs in that type's own `DiagramSpec.resolve` closure, ahead of
this call -- `resolve_diagram` only ever sees the flat shape, never a type's raw source data.

Coverage/staleness/merge-by-id are deliberately NOT folded in here (`attach_coverage`/
`attach_staleness`/`merge_by_id` below): they are opt-in add-ons a `resolve` closure calls only when
its type wants that capability, not something every diagram pays for. See
`specs/036-shared-diagram-style-catalog/research.md` Decision 5.
"""

from __future__ import annotations

from collections.abc import Callable

from codechroma.bridge.coverage import uncovered_roots
from codechroma.bridge.diagram_diagnostics import Diagnostics, keep_relation
from codechroma.bridge.diagram_paths import clean_path, resolve_path_node
from codechroma.diagrams.styles import resolve_style_overrides
from codechroma.engine import GraphEngine

__all__ = [
    "attach_coverage", "attach_origins", "attach_staleness",
    "authored_paths", "merge_by_id", "resolve_diagram",
]


def _valid_node(item: object) -> bool:
    return isinstance(item, dict) and isinstance(item.get("id"), str) and bool(item["id"])


def _resolve_node(engine: GraphEngine, item: dict, notes: Diagnostics) -> dict:
    """A copy of `item`, `node_id` filled from `path`, plus `meta.no_code_reason` if still None."""
    existing = item.get("node_id")
    if isinstance(existing, str) and existing:
        return dict(item)
    path = item.get("path")
    if not (isinstance(path, str) and path):
        return _stamp_no_code_reason(dict(item), path=None)
    node_id = resolve_path_node(engine, path)
    if node_id is None:
        notes.drop("node", item["id"], "unresolved_path", path)
        return _stamp_no_code_reason({**item, "node_id": node_id}, path=path)
    return {**item, "node_id": node_id}


def _stamp_no_code_reason(node: dict, *, path: str | None) -> dict:
    """Why a no-`node_id` node lacks one: `"planned"` > `"unresolved"` > `"conceptual"`."""
    meta = node.get("meta")
    plan_kind = meta.get("plan_kind") if isinstance(meta, dict) else None
    if plan_kind in ("add", "create"):
        reason, detail = "planned", None
    elif path:
        reason, detail = "unresolved", path
    else:
        reason, detail = "conceptual", None
    base_meta = meta if isinstance(meta, dict) else {}
    new_meta = {**base_meta, "no_code_reason": reason}
    if detail is not None:
        new_meta["no_code_detail"] = detail
    return {**node, "meta": new_meta}


def _keep_parent(node: dict, node_ids: set[str], notes: Diagnostics) -> dict:
    """Drops a dangling `parent` reference (never the node itself) -- FR-002/data-model.md."""
    parent = node.get("parent")
    if parent is None:
        return node
    if not isinstance(parent, str) or parent not in node_ids:
        notes.drop("node", node.get("id"), "dangling_endpoint", str(parent))
        return {**node, "parent": None}
    return node


def _relation_style(item: dict, edge_style: dict) -> dict | None:
    """Item override wins; failing that, the diagram's own edge_style; failing that, nothing."""
    own = item.get("style")
    if isinstance(own, dict):
        return own
    return dict(edge_style) if edge_style else None


def _groups_of(nodes: list[dict], overrides: dict) -> list[str]:
    if not overrides.get("supports_groups"):
        return []
    return sorted({node["group"] for node in nodes if isinstance(node.get("group"), str)
                   and node["group"]})


def resolve_diagram(engine: GraphEngine, data: dict, *, style_source: object = None) -> dict:
    """The one resolver every `DiagramSpec.resolve` closure calls -- see diagram-schema.md."""
    if not isinstance(data, dict):
        return data  # type: ignore[unreachable]  # defensive: a caller may pass non-dict JSON
    notes = Diagnostics()
    source = style_source if style_source is not None else data.get("style")
    overrides = resolve_style_overrides(source)
    allow_self = bool(overrides.get("allow_self_relations"))
    raw_edge_style = overrides.get("edge_style")
    edge_style = raw_edge_style if isinstance(raw_edge_style, dict) else {}

    seen_ids: set[str] = set()
    nodes: list[dict] = []
    for item in data.get("nodes") or []:
        if not _valid_node(item):
            item_id = item.get("id") if isinstance(item, dict) else None
            notes.drop("node", item_id, "invalid_shape")
            continue
        if item["id"] in seen_ids:
            notes.drop("node", item["id"], "duplicate_sibling_id")
            continue
        seen_ids.add(item["id"])
        nodes.append(_resolve_node(engine, item, notes))

    node_ids = set(seen_ids)
    nodes = [_keep_parent(node, node_ids, notes) for node in nodes]

    relations: list[dict] = []
    for item in data.get("relations") or []:
        if not keep_relation(item, node_ids, notes, allow_self=allow_self):
            continue
        assert isinstance(item, dict)
        relations.append({**item, "style": _relation_style(item, edge_style)})

    resolved = {
        **data,
        "nodes": nodes,
        "relations": relations,
        "groups": _groups_of(nodes, overrides),
        "diagnostics": notes.as_payload(),
    }
    return attach_origins(engine, resolved)


def authored_paths(data: dict) -> set[str]:
    """Every repo path a flat `nodes[]` diagram claims -- what counts as covered repo code."""
    return {
        cleaned
        for node in data.get("nodes") or []
        if isinstance(node, dict) and (cleaned := clean_path(node.get("path"))) is not None
    }


def attach_coverage(resolved: dict, engine: GraphEngine) -> dict:
    """Adds `unmapped` (c1_coverage's blind spots) from every node's own `path` (FR-006)."""
    return {**resolved, "unmapped": uncovered_roots(engine, authored_paths(resolved)).entries}


def attach_origins(engine: GraphEngine, resolved: dict) -> dict:
    """Stamps `meta.origin` (`file:line`) on each relation whose source endpoint maps to a node.

    Origin answers "where in code does this dependency come from" -- a click on the edge lands
    there. It is a property of the *source* (calling) node, derived on demand from that node's
    symbol via `engine.edge_origin(from_id)`; there is no persisted edge map to desync. A relation
    stays as-is when its source endpoint has no `node_id` (conceptual, planned) or the engine has
    no symbol for it. Merges into existing `meta`, never clobbers.
    """
    edge_origin = getattr(engine, "edge_origin", None)
    if edge_origin is None:
        return resolved
    node_id_by_author_id: dict[str, str] = {
        node["id"]: node["node_id"]
        for node in resolved.get("nodes") or []
        if isinstance(node, dict)
        and isinstance(node.get("id"), str)
        and isinstance(node.get("node_id"), str)
    }
    if not node_id_by_author_id:
        return resolved

    relations = []
    for rel in resolved.get("relations") or []:
        if not (
            isinstance(rel, dict)
            and isinstance(rel.get("from"), str)
            and isinstance(rel.get("to"), str)
        ):
            relations.append(rel)
            continue
        from_node = node_id_by_author_id.get(rel["from"])
        origin = edge_origin(from_node) if from_node else None
        if origin is None:
            relations.append(rel)
            continue
        meta = rel.get("meta")
        relations.append(
            {**rel, "meta": {**(meta if isinstance(meta, dict) else {}), "origin": origin}}
        )
    return {**resolved, "relations": relations}


def attach_staleness(
    resolved: dict, *, fingerprint: str, reviewed_fingerprint: str | None
) -> dict:
    """Adds `fingerprint`/`reviewed_fingerprint`/`stale` -- an opt-in add-on (FR-005)."""
    return {
        **resolved,
        "fingerprint": fingerprint,
        "reviewed_fingerprint": reviewed_fingerprint,
        "stale": bool(reviewed_fingerprint) and reviewed_fingerprint != fingerprint,
    }


def merge_by_id(
    current: list[dict],
    persisted: list[dict],
    *,
    fields: tuple[str, ...],
    match: Callable[[dict, dict], bool] | None = None,
) -> tuple[list[dict], set[str]]:
    """Overlays a matched persisted entry's `fields` onto each item -- by id, then by `match`."""
    persisted_by_id = {
        item["id"]: item
        for item in persisted
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    matched: set[str] = set()
    merged: list[dict] = []
    for item in current:
        entry = persisted_by_id.get(item.get("id"))
        if entry is None and match is not None:
            entry = _best_match(item, persisted_by_id, matched, match)
        if entry is None:
            merged.append(item)
            continue
        matched.add(entry["id"])
        overlay = {field: entry[field] for field in fields if field in entry}
        merged.append({**item, **overlay})
    return merged, matched


def _best_match(
    item: dict, persisted_by_id: dict, matched: set[str], match: Callable[[dict, dict], bool]
) -> dict | None:
    for candidate_id, candidate in persisted_by_id.items():
        if candidate_id in matched:
            continue
        if match(item, candidate):
            return candidate
    return None
