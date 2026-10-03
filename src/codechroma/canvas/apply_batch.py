"""The one write point onto a `CanvasDoc`: validates a whole batch before committing any of it.

Ported from canvasai's `backend/canvas/apply_batch.py`: every op in a batch is applied to a private
deep copy first; if any op fails, the whole batch is rejected and the caller's document is left
untouched (byte-identical on disk, since the route only calls `CanvasDoc.save` on success).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import cast

from pydantic import ValidationError

from codechroma.canvas.document import RENDER_KINDS, CanvasDoc, Edge, Element, Position, Size

MAX_OPS_PER_BATCH = 100
MAX_EXPLANATION_CHARS = 1000
# A batch deleting more elements/edges than this needs the caller's explicit confirmation.
MASS_DELETE_GUARD = 20

# A position-less add_element cascades down-right from the doc extent instead of
# piling every box at (0,0) -- a sane default for the direct PATCH /canvas path.
_DEFAULT_ADD_STEP_X = 340.0
_DEFAULT_ADD_STEP_Y = 120.0

_ADD_ELEMENT_OPS = {"add_element", "add_group", "add_note"}
_DELETE_OPS = {"delete_element", "delete_edge"}
VALID_OPS = _ADD_ELEMENT_OPS | {
    "add_edge", "update_element", "update_edge", "delete_element", "delete_edge",
}

_DEFAULT_RENDER = {"add_group": "group", "add_note": "note"}

# Neither kind's own web component (NoteElement.tsx/GroupFrame.tsx) ever reads node_id.
_NO_NODE_ID_RENDER_KINDS = {"note", "group"}

# Must match web/src/canvas/authoredStyle.ts's STYLE_ALLOWLIST -- kept in sync by hand.
_STYLE_ALLOWED_KEYS = {"color", "background", "border-color", "border-style"}


def _sanitize_style(value: object) -> dict[str, str] | None:
    """Drops any key outside the allow-list; `None`/empty collapses to `None` (no style at all)."""
    if not isinstance(value, dict) or not value:
        return None
    filtered = {key: val for key, val in value.items() if key in _STYLE_ALLOWED_KEYS}
    return filtered or None


class _OpFailure(Exception):
    """Raised by a per-op handler; caught once in the batch loop and turned into an `OpError`."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class OpError:
    op_index: int
    code: str
    message: str

    def to_dict(self) -> dict:
        return {"op_index": self.op_index, "code": self.code, "message": self.message}


@dataclass
class BatchResult:
    """`doc`/`id_map`/`affected` are only meaningful when `ok` is True."""

    ok: bool
    doc: CanvasDoc | None = None
    id_map: dict[str, str] = field(default_factory=dict)
    affected: list[str] = field(default_factory=list)
    errors: list[OpError] = field(default_factory=list)


def _resolve_ref(
    doc: CanvasDoc, id_map: dict[str, str], ref: str | None, container: dict, label: str
) -> str:
    """A temp_id from earlier in this batch, or a real id already in `container`."""
    if ref is None:
        raise _OpFailure("missing_field", "a required id/ref field is missing")
    real = id_map.get(ref, ref)
    if real not in container:
        raise _OpFailure("unknown_target", f"no {label} {ref!r} in this batch or document")
    return real


def _resolve_element_ref(doc: CanvasDoc, id_map: dict[str, str], ref: str | None) -> str:
    return _resolve_ref(doc, id_map, ref, doc.elements, "element")


def _resolve_edge_ref(doc: CanvasDoc, id_map: dict[str, str], ref: str | None) -> str:
    return _resolve_ref(doc, id_map, ref, doc.edges, "edge")


def _coerce[T](model_cls: type[T], value: object, what: str) -> T:
    """Builds `model_cls(**value)`, turning a malformed shape into a clean `_OpFailure`."""
    try:
        return model_cls(**cast(dict, value))
    except (TypeError, ValidationError) as exc:
        raise _OpFailure("invalid_field", f"{what}: {exc}") from exc


def _apply_add_element(
    doc: CanvasDoc, op: dict, kind: str, layer: str, id_map: dict[str, str], affected: list[str]
) -> None:
    render = op.get("render", _DEFAULT_RENDER.get(kind))
    if not render:
        raise _OpFailure("missing_field", "add_element requires a 'render' kind")
    if render not in RENDER_KINDS:
        raise _OpFailure("invalid_field", f"unknown render kind {render!r}")
    node_id = op.get("node_id")
    if node_id is not None and render in _NO_NODE_ID_RENDER_KINDS:
        # "note"/"group" render through NoteElement.tsx/GroupFrame.tsx, neither reads node_id.
        raise _OpFailure(
            "invalid_field",
            f"render {render!r} elements never carry a node_id (see "
            "NoteElement.tsx/GroupFrame.tsx) -- use render='custom' for a code-linked box",
        )
    position = op.get("position") or {}
    size = op.get("size")
    meta = op.get("meta") or {}
    if not isinstance(meta, dict):
        raise _OpFailure("invalid_field", "meta must be an object")
    group_id = op.get("group_id")
    if group_id is not None:
        group_id = _resolve_element_ref(doc, id_map, group_id)
    if not position:
        # Cascade from the current doc extent so a position-less add leaves (0,0)
        # instead of sharing it with every other.
        max_x = max_y = 0.0
        for existing in doc.elements.values():
            max_x = max(max_x, existing.position.x)
            max_y = max(max_y, existing.position.y)
        position = {"x": max_x + _DEFAULT_ADD_STEP_X, "y": max_y + _DEFAULT_ADD_STEP_Y}
    element = Element(
        render=render,
        layer=op.get("layer", layer),
        label=op.get("label", ""),
        description=op.get("description", ""),
        node_id=node_id,
        position=_coerce(Position, position, "position"),
        size=_coerce(Size, size, "size") if size else None,
        group_id=group_id,
        meta=meta,
        created_by=op.get("created_by", "ai"),
        style=_sanitize_style(op.get("style")),
    )
    doc.elements[element.id] = element
    temp_id = op.get("temp_id")
    if temp_id is not None:
        id_map[temp_id] = element.id
    affected.append(element.id)


def _apply_add_edge(
    doc: CanvasDoc, op: dict, layer: str, id_map: dict[str, str], affected: list[str]
) -> None:
    from_id = _resolve_element_ref(doc, id_map, op.get("from"))
    to_id = _resolve_element_ref(doc, id_map, op.get("to"))
    edge = Edge(
        **{"from": from_id},
        to=to_id,
        label=op.get("label", ""),
        kind=op.get("kind", "uses"),
        layer=op.get("layer", layer),
        style=_sanitize_style(op.get("style")),
        hero=bool(op.get("hero", False)),
        transport=op.get("transport"),
        origin=op.get("origin"),
    )
    doc.edges[edge.id] = edge
    temp_id = op.get("temp_id")
    if temp_id is not None:
        id_map[temp_id] = edge.id
    affected.append(edge.id)


# "created_by" is excluded on purpose -- ownership is set once at add time, never rewritable after.
_ELEMENT_PATCH_FIELDS = ("label", "description", "node_id", "group_id", "layer")


def _apply_update_element(
    doc: CanvasDoc, op: dict, id_map: dict[str, str], affected: list[str]
) -> None:
    element_id = _resolve_element_ref(doc, id_map, op.get("id"))
    element = doc.elements[element_id]
    if op.get("node_id") is not None and element.render in _NO_NODE_ID_RENDER_KINDS:
        raise _OpFailure(
            "invalid_field",
            f"render {element.render!r} elements never carry a node_id (see "
            "NoteElement.tsx/GroupFrame.tsx) -- use render='custom' for a code-linked box",
        )
    if "position" in op and op["position"] is not None:
        element.position = _coerce(Position, op["position"], "position")
    if "size" in op:
        element.size = _coerce(Size, op["size"], "size") if op["size"] else None
    if "group_id" in op and op["group_id"] is not None:
        op = {**op, "group_id": _resolve_element_ref(doc, id_map, op["group_id"])}
    if "meta" in op and op["meta"] is not None:
        if not isinstance(op["meta"], dict):
            raise _OpFailure("invalid_field", "meta must be an object")
        # Merged, not replaced -- an unrelated update must never wipe meta.recipe_key.
        element.meta = {**element.meta, **op["meta"]}
    if "style" in op:
        # Replaced, not merged -- unlike meta, `style: null` is how a caller clears a highlight.
        element.style = _sanitize_style(op["style"])
    for field_name in _ELEMENT_PATCH_FIELDS:
        if field_name in op:
            setattr(element, field_name, op[field_name])
    affected.append(element_id)


def _resolve_edge_ref_unless_cascaded(
    doc: CanvasDoc, id_map: dict[str, str], deleted: list[str], ref: str | None
) -> str | None:
    """Real edge id, or None once this batch already removed it (a cascade, or a repeat op)."""
    if ref is None:
        raise _OpFailure("missing_field", "a required id/ref field is missing")
    if id_map.get(ref, ref) in deleted:
        return None
    return _resolve_edge_ref(doc, id_map, ref)


def _apply_update_edge(
    doc: CanvasDoc, op: dict, id_map: dict[str, str], affected: list[str], deleted: list[str]
) -> None:
    edge_id = _resolve_edge_ref_unless_cascaded(doc, id_map, deleted, op.get("id"))
    if edge_id is None:
        return
    edge = doc.edges[edge_id]
    if "from" in op:
        edge.from_ = _resolve_element_ref(doc, id_map, op["from"])
    if "to" in op:
        edge.to = _resolve_element_ref(doc, id_map, op["to"])
    if "style" in op:
        # Replaced, not merged -- `style: null` is how a caller clears an edge's own override.
        edge.style = _sanitize_style(op["style"])
    for field_name in ("label", "kind", "layer", "hero", "transport", "origin"):
        if field_name in op:
            setattr(edge, field_name, op[field_name])
    affected.append(edge_id)


def _apply_delete_element(
    doc: CanvasDoc, op: dict, id_map: dict[str, str], affected: list[str], deleted: list[str]
) -> None:
    element_id = _resolve_element_ref(doc, id_map, op.get("id"))
    del doc.elements[element_id]
    affected.append(element_id)
    deleted.append(element_id)
    # Cascade: an edge pointing at a deleted element would otherwise dangle.
    for edge_id in [eid for eid, edge in doc.edges.items()
                    if edge.from_ == element_id or edge.to == element_id]:
        del doc.edges[edge_id]
        affected.append(edge_id)
        deleted.append(edge_id)
    # Cascade: any element grouped under the deleted one would otherwise point at nothing.
    for orphan in doc.elements.values():
        if orphan.group_id == element_id:
            orphan.group_id = None
            affected.append(orphan.id)


def _apply_delete_edge(
    doc: CanvasDoc, op: dict, id_map: dict[str, str], affected: list[str], deleted: list[str]
) -> None:
    edge_id = _resolve_edge_ref_unless_cascaded(doc, id_map, deleted, op.get("id"))
    if edge_id is None:
        return
    del doc.edges[edge_id]
    affected.append(edge_id)
    deleted.append(edge_id)


_HANDLERS = {
    "add_element": lambda doc, op, layer, id_map, affected, deleted: _apply_add_element(
        doc, op, "add_element", layer, id_map, affected
    ),
    "add_group": lambda doc, op, layer, id_map, affected, deleted: _apply_add_element(
        doc, op, "add_group", layer, id_map, affected
    ),
    "add_note": lambda doc, op, layer, id_map, affected, deleted: _apply_add_element(
        doc, op, "add_note", layer, id_map, affected
    ),
    "add_edge": lambda doc, op, layer, id_map, affected, deleted: _apply_add_edge(
        doc, op, layer, id_map, affected
    ),
    "update_element": lambda doc, op, layer, id_map, affected, deleted: _apply_update_element(
        doc, op, id_map, affected
    ),
    "update_edge": lambda doc, op, layer, id_map, affected, deleted: _apply_update_edge(
        doc, op, id_map, affected, deleted
    ),
    "delete_element": lambda doc, op, layer, id_map, affected, deleted: _apply_delete_element(
        doc, op, id_map, affected, deleted
    ),
    "delete_edge": lambda doc, op, layer, id_map, affected, deleted: _apply_delete_edge(
        doc, op, id_map, affected, deleted
    ),
}


def _rewrite_refs(op: dict, id_map: dict[str, str]) -> dict:
    """Swaps a `group_id`/`from`/`to` for the real id an earlier chunk's `apply_batch` minted."""
    rewritten = op
    for field_name in ("group_id", "from", "to"):
        value = op.get(field_name)
        if isinstance(value, str) and value in id_map:
            if rewritten is op:
                rewritten = dict(op)
            rewritten[field_name] = id_map[value]
    return rewritten


def apply_batch_chunked(
    doc: CanvasDoc,
    ops: list[dict],
    *,
    layer: str = "default",
    explanation: str = "",
    confirm_mass_delete: bool = False,
    chunk_size: int = MAX_OPS_PER_BATCH,
) -> BatchResult:
    """Runs `ops` as one logical batch, split into `chunk_size`-sized `apply_batch` calls."""
    if len(ops) <= chunk_size:
        return apply_batch(
            doc, ops, layer=layer, explanation=explanation, confirm_mass_delete=confirm_mass_delete
        )
    # Counted over the whole set -- a per-chunk count could split a mass delete and dodge the guard.
    delete_count = sum(1 for op in ops if op.get("op") in _DELETE_OPS)
    if not confirm_mass_delete and delete_count > MASS_DELETE_GUARD:
        return BatchResult(ok=False, errors=[OpError(
            -1, "mass_delete_guard",
            f"batch deletes {delete_count} item(s), max is {MASS_DELETE_GUARD} unconfirmed",
        )])
    working = doc
    id_map: dict[str, str] = {}
    affected: list[str] = []
    for start in range(0, len(ops), chunk_size):
        chunk = [_rewrite_refs(op, id_map) for op in ops[start:start + chunk_size]]
        # Already decided above, so a chunk's own smaller delete count can't re-trip the guard.
        result = apply_batch(
            working, chunk, layer=layer, explanation=explanation, confirm_mass_delete=True
        )
        if not result.ok:
            # Not atomic across chunks: `doc` itself stays untouched, but earlier chunks are lost.
            return result
        assert result.doc is not None  # guaranteed by ok=True, per BatchResult's own docstring
        working = result.doc
        id_map.update(result.id_map)
        affected.extend(result.affected)
    return BatchResult(ok=True, doc=working, id_map=id_map, affected=sorted(set(affected)))


def apply_batch(
    doc: CanvasDoc,
    ops: list[dict],
    *,
    layer: str = "default",
    explanation: str = "",
    confirm_mass_delete: bool = False,
) -> BatchResult:
    """Validates every op against a copy of `doc`; commits (never mutating `doc`) if all pass."""
    if len(explanation) > MAX_EXPLANATION_CHARS:
        return BatchResult(ok=False, errors=[OpError(
            -1, "explanation_too_long",
            f"explanation is {len(explanation)} chars, max is {MAX_EXPLANATION_CHARS}",
        )])
    if len(ops) > MAX_OPS_PER_BATCH:
        return BatchResult(ok=False, errors=[OpError(
            -1, "too_many_ops", f"batch has {len(ops)} ops, max is {MAX_OPS_PER_BATCH}",
        )])
    if not all(isinstance(op, dict) for op in ops):
        return BatchResult(ok=False, errors=[
            OpError(index, "invalid_op", "op must be an object")
            for index, op in enumerate(ops) if not isinstance(op, dict)
        ])

    working = doc.model_copy(deep=True)
    id_map: dict[str, str] = {}
    affected: list[str] = []
    deleted: list[str] = []
    errors: list[OpError] = []

    for index, op in enumerate(ops):
        kind = op.get("op")
        handler = _HANDLERS.get(kind) if isinstance(kind, str) else None
        if handler is None:
            errors.append(OpError(index, "unknown_op", f"unknown op {kind!r}"))
            continue
        try:
            handler(working, op, layer, id_map, affected, deleted)
        except _OpFailure as failure:
            errors.append(OpError(index, failure.code, failure.message))
        except (TypeError, ValidationError) as exc:
            errors.append(OpError(index, "invalid_field", str(exc)))

    if not errors and not confirm_mass_delete and len(deleted) > MASS_DELETE_GUARD:
        errors.append(OpError(
            -1, "mass_delete_guard",
            f"batch deletes {len(deleted)} item(s) once cascades are counted, "
            f"max is {MASS_DELETE_GUARD} unconfirmed",
        ))

    if errors:
        return BatchResult(ok=False, errors=errors)
    return BatchResult(ok=True, doc=working, id_map=id_map, affected=sorted(set(affected)))
