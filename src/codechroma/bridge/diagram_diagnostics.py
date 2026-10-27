"""What a diagram write lost on its way to the canvas, in one shape every diagram kind reuses.

Every resolver already dropped a malformed node or a dangling relation defensively, so a bad write
could not crash the route -- but it dropped them *silently*, and the run still reported success. A
skill that wrote twenty nodes with a typo'd `kind` produced the same empty payload as one that wrote
nothing, and nothing on screen said why. This accumulator makes that difference visible.

Soft by design: `Diagnostics` never raises and never removes anything the caller decided to keep.
It only records, so the canvas can render what parsed and say what didn't. The reported list is
capped by `settings.diagram_diagnostics.max_reported` while `dropped_count` keeps the true total --
a cap that hid its own truncation would read as complete coverage (see the constitution's
lazy-by-default principle).

Reason slugs are a closed vocabulary so the web can group and translate them without parsing prose.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from codechroma.config import settings

__all__ = [
    "Diagnostics",
    "DroppedItem",
    "REASONS",
    "entries_are_usable",
    "keep_relation",
    "merge_dropped",
    "relation_pair",
]


def entries_are_usable(data: object, key: str) -> bool:
    """True unless `key` is a non-empty list in which no entry is a dict with a `str` id."""
    # An EMPTY list stays valid on purpose: writing one is how a skill clears a diagram.
    if not isinstance(data, dict):
        return False
    entries = data.get(key)
    if not isinstance(entries, list) or not entries:
        return True
    return any(isinstance(item, dict) and isinstance(item.get("id"), str) for item in entries)

# Every reason a node or relation can vanish between the skill's file and the canvas.
REASONS = (
    "invalid_shape",
    "unknown_kind",
    "dangling_endpoint",
    "self_relation",
    "duplicate_sibling_id",
    "depth_capped",
    "unresolved_path",
    "status_coerced",
)


@dataclass(frozen=True)
class DroppedItem:
    """One node or relation the pipeline discarded or coerced, and why."""

    what: str
    id: str | None
    reason: str
    detail: str = ""

    def as_dict(self) -> dict:
        return {"what": self.what, "id": self.id, "reason": self.reason, "detail": self.detail}


@dataclass
class Diagnostics:
    """Collects what one resolve pass lost; `as_payload()` is what rides on the resolved diagram."""

    items: list[DroppedItem] = field(default_factory=list)

    def drop(self, what: str, item_id: object, reason: str, detail: str = "") -> None:
        """Records one loss; a non-str id becomes None so the payload stays JSON-safe."""
        clean_id = item_id if isinstance(item_id, str) else None
        self.items.append(DroppedItem(what=what, id=clean_id, reason=reason, detail=detail))

    def __len__(self) -> int:
        return len(self.items)

    def as_payload(self) -> dict:
        """The `diagnostics` value: a capped list plus the true total the cap may have hidden."""
        return build_payload([item.as_dict() for item in self.items])


def build_payload(dropped: list[dict]) -> dict:
    """Caps an already-serialized drop list, reporting how many entries the cap omitted."""
    limit = settings.diagram_diagnostics.max_reported
    shown = dropped[:limit]
    return {
        "dropped": shown,
        "dropped_count": len(dropped),
        "shown": len(shown),
        "truncated": len(dropped) > len(shown),
    }


def relation_pair(item: dict) -> str:
    """The `"from -> to"` label a dropped relation is recorded under."""
    return f"{item.get('from')} -> {item.get('to')}"


def keep_relation(
    item: object, node_ids: set[str], notes: Diagnostics, *, allow_self: bool = False
) -> bool:
    """Whether one authored relation survives; shared by every resolver checking endpoint ids."""
    if not (
        isinstance(item, dict)
        and isinstance(item.get("from"), str)
        and isinstance(item.get("to"), str)
    ):
        notes.drop("relation", None, "invalid_shape")
        return False
    pair = relation_pair(item)
    if item["from"] not in node_ids or item["to"] not in node_ids:
        notes.drop("relation", pair, "dangling_endpoint")
        return False
    if not allow_self and item["from"] == item["to"]:
        notes.drop("relation", pair, "self_relation")
        return False
    return True


def merge_dropped(*payloads: object) -> dict:
    """One `diagnostics` value from several stages -- the resolver's and the recipe converter's."""
    # Totals come from each payload's own `dropped_count`: an already-capped input would undercount.
    combined: list[dict] = []
    total = 0
    for payload in payloads:
        if not isinstance(payload, dict):
            continue
        entries = payload.get("dropped")
        if isinstance(entries, list):
            combined.extend(entry for entry in entries if isinstance(entry, dict))
        reported = payload.get("dropped_count")
        total += reported if isinstance(reported, int) else len(combined)
    merged = build_payload(combined)
    merged["dropped_count"] = max(total, merged["dropped_count"])
    merged["truncated"] = merged["dropped_count"] > merged["shown"]
    return merged


# Kept in sync with skills/codechroma-draw-diagram/scripts/check_diagram.py and the C# Diagnostics.
MESSAGE_KINDS = ("call", "return", "ai", "event", "error")
EDGE_KINDS = ("calls", "spawns", "data", "reads", "writes", "minor")
EDGE_KIND_ALIASES = (
    "call", "uses", "spawn", "process", "read", "write", "secondary", "imports", "implements",
    "extends", "inherits", "composes", "contains", "depends", "depends_on", "removed",
)
_PLAIN_EDGE_KINDS = ("", "calls", "call", "uses")
# These author structural verbs (observes, wraps, ...), so an unknown kind there is not a typo.
_STRUCTURAL_KINDS = ("c1", "patterns", "impact")
_FAILURE_WORDS = re.compile(r"\b(error|fail\w*|denied|timeout|timed out)\b", re.IGNORECASE)
_SPAWN_WORDS = re.compile(
    r"\b(spawn\w*|launch\w*|(start|starts|starting|run|runs|fork\w*)\s+(a\s+|an\s+|the\s+)?"
    r"(sub)?(process|cli|agent|worker|daemon))\b", re.IGNORECASE,
)
_DATA_WORDS = re.compile(
    r"\b(read|reads|write|writes|reading|writing|persist\w*|stores?|saves?)\b.{0,40}"
    r"\b(files?|disk|database|db|sqlite|store|cache|json)\b", re.IGNORECASE,
)


def advise_relations(relations: object, kind: object, notes: Diagnostics) -> None:
    """Records check_diagram.py's edge/message-kind advisories as soft diagnostics (never drops)."""
    if not isinstance(relations, list) or kind == "custom":
        return
    for relation in relations:
        if not isinstance(relation, dict):
            continue
        if kind == "sequence":
            _advise_message(relation, notes)
        else:
            _advise_edge(relation, notes, structural=kind in _STRUCTURAL_KINDS)


def _advise_message(relation: dict, notes: Diagnostics) -> None:
    msg_kind, ident = relation.get("kind"), relation.get("id")
    if isinstance(msg_kind, str) and msg_kind not in MESSAGE_KINDS:
        notes.drop("relation", ident, "bad_message_kind", f"kind={msg_kind!r}")
    label = str(relation.get("label") or "")
    if msg_kind != "error" and not relation.get("failure") and _FAILURE_WORDS.search(label):
        notes.drop("relation", ident, "failure_kind", f"label {label!r}: set kind to error")


def _advise_edge(relation: dict, notes: Diagnostics, *, structural: bool) -> None:
    edge_kind = relation.get("kind")
    pair = relation_pair(relation)
    known = EDGE_KINDS + EDGE_KIND_ALIASES
    unknown = edge_kind is not None and (
        not isinstance(edge_kind, str) or edge_kind.strip().lower() not in known
    )
    if not structural and unknown:
        notes.drop("relation", pair, "bad_edge_kind", f"kind={edge_kind!r}")
        return
    plain = edge_kind is None or (
        isinstance(edge_kind, str) and edge_kind.strip().lower() in _PLAIN_EDGE_KINDS
    )
    label = relation.get("label")
    if not plain or not isinstance(label, str):
        return
    if _SPAWN_WORDS.search(label):
        notes.drop("relation", pair, "edge_kind_spawn", f"label {label!r}: set kind to spawns")
    elif _DATA_WORDS.search(label):
        notes.drop("relation", pair, "edge_kind_data", f"label {label!r}: set kind to data")

