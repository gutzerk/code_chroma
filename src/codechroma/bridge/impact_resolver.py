"""Serves the authored impact.json to the canvas, merged with the raw deterministic slice.

The deterministic slice (`impact-context`) is the skill's *context*, not its output: the skill
decides the final boxes (`impact.json`) with judgment — keep the real changed/plan seeds, keep the
one-hop callers/callees that matter, collapse the untouched rest into a few context boxes. This
resolver reads that authored file, validates it (via the shared `resolve_diagram`), and flags when
the underlying slice has moved on (`stale`, via a fingerprint) so the canvas can offer Regenerate.
No crafted file (`has_diagram` false) renders the empty state, never a half-drawn slice.

036-shared-diagram-style-catalog: node/relation validation itself now goes through
`diagram_resolver.resolve_diagram()` -- impact's own job, ahead of that call, is deriving the
fingerprint/source/feature/seed_count a diff/plan slice needs, which no other diagram type has, plus
its own stricter `_drop_unseeded` pass: unlike c1/custom, impact never resolves a `path` itself (the
skill already did), so a box with no `node_id` at all is dropped outright, not kept null.
"""

from __future__ import annotations

from pathlib import Path

from codechroma.bridge.diagram_diagnostics import Diagnostics, merge_dropped
from codechroma.bridge.diagram_resolver import resolve_diagram
from codechroma.bridge.impact_context import (
    _feature_spec_seeds,
    authored_feature,
    authored_source,
    impact_fingerprint,
    impact_seed_count,
)
from codechroma.diagrams.registry import BUILTIN_TYPES

__all__ = ["impact_path", "resolve_impact_diagram"]

# The only four plan roles that spell a colour/chip; anything else is dropped, never mis-coloured.
_PLAN_STATUSES = ("new", "modified", "deleted", "context")


def impact_path(repo_root: Path) -> Path:
    return repo_root / BUILTIN_TYPES["impact"].artifact


def _keep_seeded_node(item: object, notes: Diagnostics) -> bool:
    """Impact's own, stricter rule: a box with no already-resolved `node_id` is dropped outright."""
    if isinstance(item, dict) and isinstance(item.get("node_id"), str) and item["node_id"]:
        return True
    item_id = item.get("id") if isinstance(item, dict) else None
    named = isinstance(item_id, str) and bool(item_id)
    notes.drop("node", item_id, "unresolved_path" if named else "invalid_shape")
    return False


def _drop_unseeded(authored: dict, notes: Diagnostics) -> dict:
    nodes = authored.get("nodes")
    if not isinstance(nodes, list):
        return authored
    return {**authored, "nodes": [item for item in nodes if _keep_seeded_node(item, notes)]}


def _coerce_statuses(resolved: dict) -> dict:
    """A node's `meta.status` must be new/modified/deleted/context -- the one type impact reads."""
    notes = Diagnostics()
    nodes = []
    for node in resolved["nodes"]:
        meta = dict(node.get("meta") or {})
        status = meta.get("status")
        if status is not None and status not in _PLAN_STATUSES:
            notes.drop("node", node.get("id"), "status_coerced", str(status))
            meta["status"] = None
        nodes.append({**node, "meta": meta})
    return {
        **resolved, "nodes": nodes,
        "diagnostics": merge_dropped(resolved.get("diagnostics"), notes.as_payload()),
    }


def resolve_impact_diagram(ws) -> dict:
    """The ImpactDiagram-shaped payload GET /repos/{id}/impact returns to the canvas."""
    # Staleness compares like-for-like against the authored `source`/`feature`, never a mixed pair.
    raw = ws.load_diagram("impact")
    authored = raw if isinstance(raw, dict) else {}
    source = authored_source(authored)
    feature = authored_feature(authored)
    seed_notes = Diagnostics()
    seeded = _drop_unseeded({**authored, "type": "impact"}, seed_notes)
    resolved = _coerce_statuses(resolve_diagram(ws.engine, seeded))
    resolved["diagnostics"] = merge_dropped(resolved.get("diagnostics"), seed_notes.as_payload())
    resolved["has_diagram"] = bool(authored)
    resolved["source"] = source
    resolved["feature"] = feature
    resolved["node_count"] = len(resolved["nodes"])
    resolved["truncated"] = False

    reviewed = (
        authored.get("fingerprint") if isinstance(authored.get("fingerprint"), str) else None
    )
    # No fingerprint to compare: skip re-deriving the slice on the common no-diagram read.
    if not reviewed:
        return {
            **resolved, "seed_count": 0, "fingerprint": "",
            "reviewed_fingerprint": reviewed, "stale": False,
        }
    # Fingerprint only, from cheap git status / spec seeds — never the slice rebuild that lagged.
    seeds_by_id = _feature_spec_seeds(ws, feature) if source == "plan" else None
    current_fingerprint = impact_fingerprint(ws, source, feature, seeds_by_id=seeds_by_id)
    return {
        **resolved,
        "seed_count": impact_seed_count(ws, source, feature, seeds_by_id=seeds_by_id),
        "fingerprint": current_fingerprint,
        "reviewed_fingerprint": reviewed,
        "stale": bool(reviewed) and reviewed != current_fingerprint,
    }
