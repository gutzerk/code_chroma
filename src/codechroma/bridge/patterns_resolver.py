"""Merges the graph's always-fresh heuristic pattern candidates with the authored patterns.json.

036-shared-diagram-style-catalog: `PatternDiagramAdapter` is the Adapter (plan.md's Pattern 2) that
turns the detector's `PatternInstance`/`PatternParticipant` output into the one shared flat
`nodes[]` shape every diagram type now authors -- one node per instance (`kind: "pattern-instance"`)
and one node per participant (`parent`: the instance's id), instead of the old nested
`instances[].participants[]`. Participants becoming real, addressable nodes is a deliberate
capability gain (Decision 7/research.md): their own `description`/`relations[]` were always
authored but had no box to render on before this feature.

`resolve_patterns_diagram` merges that always-regenerated candidate set with whatever a skill
persisted onto `patterns.json` -- by id first, or (for a renamed pattern instance) by how many of
its participants' `node_id`s overlap with a persisted instance's own participants, mirroring
`_persisted_match`'s pre-036 fallback. `merge_by_id` (`diagram_resolver.py`) does the by-id half;
the participant-overlap fallback and the nested `meta.confirmed`/`meta.confidence` overlay are
patterns' own business, kept here rather than forced into that shared, simpler primitive.
"""

from __future__ import annotations

from pathlib import Path

from codechroma.bridge.diagram_diagnostics import Diagnostics, merge_dropped
from codechroma.bridge.diagram_resolver import attach_staleness, resolve_diagram
from codechroma.diagrams.registry import BUILTIN_TYPES
from codechroma.diagrams.styles import resolve_style_overrides
from codechroma.engine import GraphEngine
from codechroma.graph.models import Graph, PatternInstance
from codechroma.patterns.serialize import (
    INSTANCE_KIND,
    fingerprint_for,
    instance_node,
    participant_node,
    serialize_instance,
)

# The only two kinds a free-standing connective box (not an instance/participant) may carry.
_FREE_NODE_KINDS = ("infra", "external")

__all__ = ["PatternDiagramAdapter", "patterns_path", "resolve_patterns_diagram"]

_INSTANCE_OVERLAY_FIELDS = ("name", "description")
_PARTICIPANT_OVERLAY_FIELDS = ("description", "style")


def patterns_path(repo_root: Path) -> Path:
    return repo_root / BUILTIN_TYPES["patterns"].artifact


class PatternDiagramAdapter:
    """The heuristic detector's candidates, reshaped into the one shared flat diagram shape."""

    def to_shared_diagram(self, candidates: list[PatternInstance]) -> dict:
        nodes: list[dict] = []
        relations: list[dict] = []
        seen_participants: set[str] = set()
        for instance in candidates:
            serialized = serialize_instance(instance)
            nodes.append(instance_node(serialized))
            for participant in serialized["participants"]:
                # A class owned by an earlier instance reuses that node -- never a duplicate.
                if participant["id"] in seen_participants:
                    continue
                seen_participants.add(participant["id"])
                nodes.append(participant_node(participant, serialized["id"]))
            relations.extend(serialized["relations"])
        return {"nodes": nodes, "relations": relations}


def _node_ids_by_parent(nodes: list[dict]) -> dict[str, set[str]]:
    """Every node's own resolved `node_id`, grouped by its `parent`."""
    by_parent: dict[str, set[str]] = {}
    for node in nodes:
        parent, node_id = node.get("parent"), node.get("node_id")
        if isinstance(parent, str) and isinstance(node_id, str):
            by_parent.setdefault(parent, set()).add(node_id)
    return by_parent


def _best_instance_match(
    item_id: str,
    node_ids: set[str],
    candidates: dict[str, dict],
    matched: set[str],
    persisted_children: dict[str, set[str]],
) -> dict | None:
    """The unmatched persisted instance whose own participants overlap this one's the most."""
    if not node_ids:
        return None
    best, best_overlap = None, 0
    for candidate_id, entry in candidates.items():
        if candidate_id in matched:
            continue
        overlap = len(node_ids & persisted_children.get(candidate_id, set()))
        if overlap > best_overlap:
            best, best_overlap = entry, overlap
    return best


def _overlay(item: dict, entry: dict) -> dict:
    """Overlays a matched persisted entry's authored fields onto a regenerated current node."""
    merged = dict(item)
    if item.get("kind") == INSTANCE_KIND:
        for field in _INSTANCE_OVERLAY_FIELDS:
            if entry.get(field):
                merged[field] = entry[field]
        raw_entry_meta = entry.get("meta")
        entry_meta: dict = raw_entry_meta if isinstance(raw_entry_meta, dict) else {}
        merged_meta = dict(merged.get("meta") or {})
        for key in ("confirmed", "confidence"):
            if key in entry_meta:
                merged_meta[key] = entry_meta[key]
        merged["meta"] = merged_meta
    else:
        for field in _PARTICIPANT_OVERLAY_FIELDS:
            if field in entry:
                merged[field] = entry[field]
    return merged


def _merge_patterns(current: list[dict], persisted: list[dict]) -> tuple[list[dict], set[str]]:
    """Every current node overlaid with its persisted match; returns which persisted ids matched."""
    persisted_by_id = {
        item["id"]: item
        for item in persisted
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    instance_candidates = {
        item_id: item
        for item_id, item in persisted_by_id.items()
        if item.get("kind") == INSTANCE_KIND
    }
    node_ids_by_instance = _node_ids_by_parent(current)
    persisted_children = _node_ids_by_parent(persisted)

    matched: set[str] = set()
    merged: list[dict] = []
    for item in current:
        entry = persisted_by_id.get(item["id"])
        if entry is None and item.get("kind") == INSTANCE_KIND:
            entry = _best_instance_match(
                item["id"], node_ids_by_instance.get(item["id"], set()),
                instance_candidates, matched, persisted_children,
            )
        if entry is None:
            merged.append(item)
            continue
        matched.add(entry["id"])
        merged.append(_overlay(item, entry))
    return merged, matched


def _drop_rejected(nodes: list[dict]) -> list[dict]:
    """A skill-rejected instance (`confirmed: false`) and its own participants are noise."""
    rejected = {
        node["id"] for node in nodes
        if node.get("kind") == INSTANCE_KIND and node.get("meta", {}).get("confirmed") is False
    }
    return [
        node for node in nodes
        if node["id"] not in rejected and node.get("parent") not in rejected
    ]


def _is_free_node(item: dict) -> bool:
    """Not part of the instance/participant family at all -- the only kind of node this gates."""
    return item.get("parent") is None and item.get("kind") != INSTANCE_KIND


def _keep_free_node(item: dict, notes: Diagnostics) -> bool:
    """A free-standing connective box outside `_FREE_NODE_KINDS` loses the whole box (pre-036)."""
    if not _is_free_node(item) or item.get("kind") in _FREE_NODE_KINDS:
        return True
    notes.drop("node", item.get("id"), "unknown_kind", str(item.get("kind") or ""))
    return False


def resolve_patterns_diagram(engine: GraphEngine, graph: Graph, patterns_json: dict) -> dict:
    """The shared-shape payload `GET /repos/{id}/patterns` returns, merged and style-resolved."""
    authored = patterns_json if isinstance(patterns_json, dict) else {}
    candidates = graph.pattern_candidates
    shared = PatternDiagramAdapter().to_shared_diagram(candidates)
    current, candidate_relations = shared["nodes"], shared["relations"]
    persisted_nodes = authored.get("nodes")
    persisted_nodes = persisted_nodes if isinstance(persisted_nodes, list) else []

    merged, matched_ids = _merge_patterns(current, persisted_nodes)
    leftovers = [
        item for item in persisted_nodes
        if isinstance(item, dict) and isinstance(item.get("id"), str)
        and item["id"] not in matched_ids
    ]
    kind_notes = Diagnostics()
    leftovers = [item for item in leftovers if _keep_free_node(item, kind_notes)]
    all_nodes = _drop_rejected(merged + leftovers)

    # A rejected instance's participants are dropped from nodes[] above, so any relation from a
    # candidate (or authored entry) that references a dropped box is noise too -- dropping only the
    # box would leave a dangling-endpoint relation that the resolver flags as "not drawn". Keep only
    # relations whose both endpoints survive the node set.
    surviving_ids = {node["id"] for node in all_nodes}
    kept_relations = [
        rel
        for rel in candidate_relations + (authored.get("relations") or [])
        if isinstance(rel, dict)
        and rel.get("from") in surviving_ids
        and rel.get("to") in surviving_ids
    ]

    data = {
        "type": "patterns",
        "style": authored.get("style"),
        "nodes": all_nodes,
        "relations": kept_relations,
        "generated_at": authored.get("generated_at"),
    }
    # Patterns has always allowed self-relations (e.g. a recursive call) regardless of style.
    overrides = {**resolve_style_overrides(data["style"]), "allow_self_relations": True}
    resolved = resolve_diagram(engine, data, style_source=overrides)
    resolved["diagnostics"] = merge_dropped(resolved.get("diagnostics"), kind_notes.as_payload())
    resolved["has_diagram"] = bool(authored)

    raw_reviewed = authored.get("fingerprint")
    reviewed_fingerprint = raw_reviewed if isinstance(raw_reviewed, str) else None
    return attach_staleness(
        resolved, fingerprint=fingerprint_for(candidates), reviewed_fingerprint=reviewed_fingerprint
    )
