"""Serializing heuristic PatternInstances and fingerprinting the candidate set's structure.

Core, not bridge: the AI generator (`context/patterns_generator.py`) needs both, and the engine
must stay importable without the web bridge. `bridge/patterns_resolver.py` builds its merge logic
on top of these.
"""

from __future__ import annotations

from codechroma.fingerprint import hash_lines
from codechroma.graph.models import PatternInstance, PatternParticipant, PatternRelation

__all__ = [
    "INSTANCE_KIND", "fingerprint_for", "instance_node", "participant_node", "serialize_instance",
]

INSTANCE_KIND = "pattern-instance"


def fingerprint_for(candidates: list[PatternInstance]) -> str:
    """Stable hash of the current heuristic candidate set's structure, not its confirmed prose."""
    return hash_lines(
        f"{c.type.value} {c.id} " + ",".join(sorted(p.id for p in c.participants))
        for c in candidates
    )


def _serialize_participant(participant: PatternParticipant) -> dict:
    return {
        "id": participant.id,
        "role": participant.role.value,
        "name": participant.name,
        "qualified_name": participant.qualified_name,
        "node_id": participant.node_id,
        "path": participant.path,
        "description": participant.description,
    }


def _serialize_relation(relation: PatternRelation) -> dict:
    return {
        "from": relation.from_id,
        "to": relation.to_id,
        "kind": relation.kind.value,
        "label": relation.label,
    }


def serialize_instance(instance: PatternInstance) -> dict:
    return {
        "id": instance.id,
        "type": instance.type.value,
        "name": instance.name,
        "description": instance.description,
        "confirmed": instance.confirmed,
        "confidence": instance.confidence,
        "participants": [_serialize_participant(p) for p in instance.participants],
        "relations": [_serialize_relation(r) for r in instance.relations],
    }


def instance_node(serialized: dict) -> dict:
    """One pattern instance as a shared flat-diagram node -- shared by generator and resolver."""
    return {
        "id": serialized["id"],
        "name": serialized["name"],
        "description": serialized["description"] or "",
        "kind": INSTANCE_KIND,
        "meta": {
            "type": serialized["type"],
            "confirmed": serialized["confirmed"],
            "confidence": serialized["confidence"],
        },
    }


def participant_node(participant: dict, instance_id: str) -> dict:
    """One participant as a shared flat-diagram node, nested under its instance."""
    return {
        "id": participant["id"],
        "parent": instance_id,
        "name": participant["name"],
        "description": participant["description"] or "",
        "node_id": participant.get("node_id"),
        "path": participant.get("path"),
        "meta": {"role": participant["role"]},
    }
