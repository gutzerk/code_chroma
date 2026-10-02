"""Converts a pre-036 saved diagram file to the one shared flat `nodes[]`/`relations[]` shape.

Best-effort and one-time: `Workspace.load_diagram` calls `migrate_if_legacy` on every read, and a
file that converts gets written back once (see `contracts/legacy-migration.md`), so later reads see
the new shape directly and this module does no work at all. A file this can't parse is left on disk
untouched -- nothing here ever raises; a caller sees `changed=False` and falls back to "please
regenerate this diagram" (FR-008/US4), never a crash.

c1 is the one real conversion: its nested `system`/`actors[].children` tree becomes flat nodes with
`parent`, and every relationship endpoint (a bare id or a full id trail, same rule
`c1_resolver.BlockIndex` used to apply) is remapped onto the new flat id it was assigned. patterns'
old `patterns[]`/`unconfirmed[]` (with nested `participants[]`) becomes one node per instance/
participant the same way `PatternDiagramAdapter` already shapes live candidates. impact and custom
were already flat before this feature (`research.md` Decision 1) -- they only gain `type`/`style`
when absent, no structural change.
"""

from __future__ import annotations

from typing import Any

from codechroma.context.id_allocation import IdAddressBook

__all__ = ["migrate", "migrate_if_legacy", "needs_regeneration"]

_MAX_DEPTH = 5


def migrate(kind: str, data: dict) -> tuple[dict, str]:
    """One-pass shape check + convert; status is one of unchanged/converted/needs_regeneration."""
    if not _is_legacy_shape(kind, data):
        return data, "unchanged"
    try:
        converted = _convert(kind, data)
    except Exception:
        converted = None
    if converted is None:
        return data, "needs_regeneration"
    return converted, "converted"


def migrate_if_legacy(kind: str, data: dict) -> tuple[dict, bool]:
    """`data` unchanged unless it's a legacy shape that converts; then the converted shape."""
    migrated, status = migrate(kind, data)
    return migrated, status == "converted"


def needs_regeneration(kind: str, data: dict) -> bool:
    """True when `data` looked like a pre-036 file but the converter could not parse it (FR-008)."""
    return migrate(kind, data)[1] == "needs_regeneration"


def _is_legacy_shape(kind: str, data: object) -> bool:
    """Patterns' old shape can carry `nodes[]` too, so its own markers are checked directly."""
    if not isinstance(data, dict) or not data:
        return False
    if kind == "c1":
        has_nodes = isinstance(data.get("nodes"), list)
        return not has_nodes and (
            isinstance(data.get("system"), dict) or isinstance(data.get("actors"), list)
        )
    if kind == "patterns":
        return isinstance(data.get("patterns"), list) or isinstance(data.get("unconfirmed"), list)
    return False


def _convert(kind: str, data: dict) -> dict | None:
    if kind == "c1":
        return _convert_c1(data)
    if kind == "patterns":
        return _convert_patterns(data)
    return None


def _copy_optional(child: dict, node: dict, *keys: str) -> None:
    for key in keys:
        value = child.get(key)
        if value:
            node[key] = value


def _convert_c1(data: dict) -> dict | None:
    system = data.get("system")
    if not isinstance(system, dict):
        return None
    # An authored endpoint may name a bare id (ambiguous once repeated) or a full trail (never is).
    ids = IdAddressBook()
    nodes: list[dict] = []

    def _walk(children: object, parent_id: str, parent_trail: str, depth: int) -> None:
        if not isinstance(children, list) or depth > _MAX_DEPTH:
            return
        for child in children:
            if not isinstance(child, dict) or not child.get("id"):
                continue
            if not isinstance(child["id"], str):
                continue
            bare = child["id"]
            trail = f"{parent_trail}/{bare}"
            new_id = ids.fresh(bare)
            ids.address(trail, bare, new_id)
            node: dict[str, Any] = {"id": new_id, "name": str(child.get("name") or bare)}
            node["parent"] = parent_id
            _copy_optional(child, node, "description", "path", "kind", "icon", "style")
            nodes.append(node)
            _walk(child.get("children"), new_id, trail, depth + 1)

    system_id = ids.fresh("system")
    ids.address("system", "system", system_id)
    nodes.append({
        "id": system_id, "name": str(system.get("name") or "System"),
        "description": system.get("description", ""), "kind": "system",
    })
    _walk(system.get("children"), system_id, "system", 1)

    actors = data.get("actors")
    if isinstance(actors, list):
        for actor in actors:
            if not (isinstance(actor, dict) and isinstance(actor.get("id"), str) and actor["id"]):
                continue
            bare = actor["id"]
            new_id = ids.fresh(bare)
            ids.address(bare, bare, new_id)
            actor_node: dict[str, Any] = {
                "id": new_id, "name": str(actor.get("name") or bare),
                "kind": actor.get("type") or "external_system",
            }
            _copy_optional(actor, actor_node, "description", "icon")
            nodes.append(actor_node)
            _walk(actor.get("children"), new_id, bare, 1)

    relations = []
    for rel in data.get("relationships") or []:
        if not isinstance(rel, dict):
            continue
        rel_from, rel_to = rel.get("from"), rel.get("to")
        source = ids.resolve(rel_from) if isinstance(rel_from, str) else None
        target = ids.resolve(rel_to) if isinstance(rel_to, str) else None
        if source is None or target is None:
            continue
        relation = {"from": source, "to": target, "label": rel.get("label", "")}
        _copy_optional(rel, relation, "technology")
        relations.append(relation)

    return {"type": "c1", "style": "boxes-arrows", "nodes": nodes, "relations": relations}


def _convert_patterns(data: dict) -> dict:
    ids = IdAddressBook()
    nodes: list[dict] = []
    for instance in (data.get("patterns") or []) + (data.get("unconfirmed") or []):
        if not isinstance(instance, dict) or not isinstance(instance.get("id"), str):
            continue
        instance_id = ids.fresh(instance["id"])
        nodes.append({
            "id": instance_id, "name": str(instance.get("name") or instance_id),
            "description": instance.get("description") or "", "kind": "pattern-instance",
            "meta": {
                "type": instance.get("type"), "confirmed": instance.get("confirmed"),
                "confidence": instance.get("confidence"),
            },
        })
        for participant in instance.get("participants") or []:
            if not isinstance(participant, dict) or not isinstance(participant.get("id"), str):
                continue
            participant_id = ids.fresh(participant["id"])
            node: dict[str, Any] = {
                "id": participant_id, "parent": instance_id,
                "name": str(participant.get("name") or participant_id),
                "description": participant.get("description") or "",
            }
            _copy_optional(participant, node, "node_id", "path", "style")
            if participant.get("role"):
                node["meta"] = {"role": participant["role"]}
            nodes.append(node)

    for item in data.get("nodes") or []:
        if isinstance(item, dict) and isinstance(item.get("id"), str):
            nodes.append({**item, "id": ids.fresh(item["id"])})

    return {
        "type": "patterns", "nodes": nodes, "relations": data.get("relations") or [],
        "generated_at": data.get("generated_at"), "fingerprint": data.get("fingerprint"),
    }
