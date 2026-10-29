"""Reads and writes `question` elements through the one canvas write point (`apply_batch`)."""

from __future__ import annotations

import time
import uuid
from collections.abc import Callable

from codechroma.bridge.workspaces import Workspace
from codechroma.canvas.apply_batch import BatchResult, apply_batch, apply_batch_chunked
from codechroma.canvas.document import CanvasDoc, Element
from codechroma.canvas.locks import canvas_lock
from codechroma.questions import diagrams
from codechroma.questions.models import AskRequest, QuestionResult

AWAITING_DELIVERY = "awaiting_delivery"
# Questions a completed batch removed, per (canvas file, session_id): later steps count on.
_delivered: dict[tuple[str, str], int] = {}


class QuestionWriteError(RuntimeError):
    """The canvas rejected or failed to save a question write."""


def commit_canvas_batch(ws: Workspace, result: BatchResult) -> dict:
    """Lazy proxy: importing bridge.routes at module load would cycle through its routers."""
    from codechroma.bridge.routes._canvas_write import commit_canvas_batch as commit

    return commit(ws, result)


def _commit(ws: Workspace, build_ops: Callable[[CanvasDoc], list[dict]]) -> dict:
    with canvas_lock(ws.id):
        doc = CanvasDoc.load(ws.canvas_core_path, ws.diagrams_root)
        result = apply_batch(doc, build_ops(doc), explanation="ai question")
        response = commit_canvas_batch(ws, result)
    if not response["ok"]:
        raise QuestionWriteError(str(response["errors"]))
    return response


def _next_step(ws: Workspace, doc: CanvasDoc, session_id: str | None) -> int:
    if not session_id:
        return 1
    return 1 + _delivered.get((str(ws.canvas_core_path), session_id), 0) + sum(
        1 for e in doc.elements.values()
        if e.render == "question" and e.meta.get("session_id") == session_id
    )


def _options_meta(request: AskRequest) -> list[dict]:
    return [option.model_dump() for option in request.options]


def _prune_ops(doc: CanvasDoc, keep: set[str]) -> list[dict]:
    """Deletes draft diagrams nobody adopted within the TTL, so abandoned asks leave no layer."""
    cutoff = time.time() - diagrams.DRAFT_TTL_SECONDS
    stale = {
        e.id for e in doc.elements.values()
        if e.id not in keep and diagrams.is_draft_layer(e.layer)
        and e.meta.get("diagram_root") and float(e.meta.get("drawn_at") or 0) < cutoff
    }
    stale |= {
        e.id for e in doc.elements.values()
        if e.group_id in stale and e.id not in keep and diagrams.is_draft_layer(e.layer)
    }
    return [{"op": "delete_element", "id": i} for i in sorted(stale)]


def _adopt_ops(doc: CanvasDoc, request: AskRequest, question_id: str) -> list[dict]:
    """Moves the draft-layer diagrams this question's options reference onto its own layer."""
    target = diagrams.layer_for(question_id, "")
    refs = {o.diagram_ref for o in request.options if o.diagram_ref}
    roots = [
        doc.elements[r] for r in refs
        if r in doc.elements and diagrams.is_draft_layer(doc.elements[r].layer)
    ]
    moved = {root.id for root in roots}
    moved |= {
        e.id for e in doc.elements.values()
        if e.group_id in moved and diagrams.is_draft_layer(e.layer)
    }
    ops: list[dict] = [{"op": "update_element", "id": i, "layer": target} for i in sorted(moved)]
    ops.extend(_prune_ops(doc, moved))
    ops.extend(
        {"op": "update_edge", "id": edge_id, "layer": target}
        for edge_id, edge in doc.edges.items()
        if edge.from_ in moved and edge.to in moved and diagrams.is_draft_layer(edge.layer)
    )
    return ops


def open_question(
    ws: Workspace, request: AskRequest, question_id: str, extra_meta: dict | None = None
) -> str:
    """Adds the `question` element for a caller-chosen id; returns the element id."""

    def build(doc: CanvasDoc) -> list[dict]:
        meta = {
            "question_id": question_id,
            "session_id": request.session_id,
            "step": _next_step(ws, doc, request.session_id),
            "total": request.total,
            "kind": request.kind,
            "state": "open",
            "answer": None,
            "option_id": None,
            "allow_custom": request.allow_custom,
            "allow_skip": request.allow_skip,
            "agent_id": request.agent_id,
            "options": _options_meta(request),
            **(extra_meta or {}),
        }
        return [{
            "op": "add_element", "temp_id": "q", "render": "question", "layer": "questions",
            "label": request.question, "meta": meta,
        }, *_adopt_ops(doc, request, question_id)]

    return _commit(ws, build)["id_map"]["q"]


def find_element(ws: Workspace, question_id: str) -> Element | None:
    """The `question` element carrying this id, or None."""
    doc = CanvasDoc.load(ws.canvas_core_path, ws.diagrams_root)
    for element in doc.elements.values():
        if element.render == "question" and element.meta.get("question_id") == question_id:
            return element
    return None


def list_questions(ws: Workspace) -> list[Element]:
    """Every `question` element, in canvas insertion order."""
    doc = CanvasDoc.load(ws.canvas_core_path, ws.diagrams_root)
    return [e for e in doc.elements.values() if e.render == "question"]


def settle(ws: Workspace, element: Element, state: str, result: QuestionResult) -> Element:
    """Writes the settled state onto the element's meta and marks it for the next wake-up."""
    meta = {
        "state": state, "answer": result.answer, "option_id": result.option_id,
        AWAITING_DELIVERY: True,
    }
    _commit(ws, lambda _doc: [{"op": "update_element", "id": element.id, "meta": meta}])
    return element.model_copy(update={"meta": {**element.meta, **meta}})


def _cleanup_ops(doc: CanvasDoc, questions: list[Element]) -> list[dict]:
    """Deletes the questions, their `decisions/<qid>` layers and the diagrams options reference."""
    layers = {
        diagrams.layer_for(q.meta["question_id"], "") for q in questions
        if q.meta.get("question_id")
    }
    refs = {o.get("diagram_ref") for q in questions for o in q.meta.get("options", [])}
    roots = {
        r for r in refs
        if r and r in doc.elements and diagrams.is_decision_layer(doc.elements[r].layer)
    }
    doomed = {q.id for q in questions} | {
        e.id for e in doc.elements.values()
        if e.layer in layers or e.id in roots
        or (e.group_id in roots and diagrams.is_decision_layer(e.layer))
    }
    return [{"op": "delete_element", "id": i} for i in sorted(doomed)]


def complete_batch(ws: Workspace, agent_id: str) -> list[Element]:
    """Once no question of the agent is open, deletes its settled ones; returns the undelivered."""
    with canvas_lock(ws.id):
        doc = CanvasDoc.load(ws.canvas_core_path, ws.diagrams_root)
        mine = [
            e for e in doc.elements.values()
            if e.render == "question" and e.meta.get("agent_id") == agent_id
        ]
        batch = [e for e in mine if e.meta.get(AWAITING_DELIVERY)]
        if not batch or any(e.meta.get("state") == "open" for e in mine):
            return []
        result = apply_batch_chunked(
            doc, _cleanup_ops(doc, mine), explanation="ai question", confirm_mass_delete=True
        )
        response = commit_canvas_batch(ws, result)
        if not response["ok"]:
            raise QuestionWriteError(str(response["errors"]))
        for e in mine:
            if session := e.meta.get("session_id"):
                key = (str(ws.canvas_core_path), session)
                _delivered[key] = _delivered.get(key, 0) + 1
    return batch


def result_from(element: Element) -> QuestionResult | None:
    """The settled result recorded on an element, or None while it is still open."""
    state = element.meta.get("state")
    if state == "answered":
        return QuestionResult(
            answer=element.meta.get("answer"), option_id=element.meta.get("option_id")
        )
    if state == "skipped":
        return QuestionResult(skipped=True)
    return None


def reopen(ws: Workspace, element: Element) -> list[str]:
    """Reopens a question and deletes later steps of its session; returns the deleted ids."""
    session_id = element.meta.get("session_id")
    step = element.meta.get("step") or 0
    later = [
        e.id for e in list_questions(ws)
        if session_id and e.meta.get("session_id") == session_id
        and (e.meta.get("step") or 0) > step
    ]
    ops: list[dict] = [{"op": "delete_element", "id": i} for i in later]
    ops.append({
        "op": "update_element", "id": element.id,
        "meta": {"state": "open", "answer": None, "option_id": None, "revised": True},
    })
    _commit(ws, lambda _doc: ops)
    return later


def known_element_ids(ws: Workspace) -> set[str]:
    """Every element id on the canvas, for checking `diagram_ref`."""
    return set(CanvasDoc.load(ws.canvas_core_path, ws.diagrams_root).elements)


def find_diagram_requested(
    ws: Workspace, request: AskRequest
) -> tuple[Element, list[Element]] | None:
    """The open diagram-requested card this re-ask continues, and its older duplicates."""
    pending = [
        e for e in list_questions(ws)
        if e.meta.get("state") == "open" and e.meta.get("diagram_requested")
    ]
    if request.session_id:
        pool = [e for e in pending if e.meta.get("session_id") == request.session_id]
    else:
        pool = [e for e in pending if not e.meta.get("session_id") and e.label == request.question]
    return (pool[-1], pool[:-1]) if pool else None


def reask(
    ws: Workspace, element: Element, request: AskRequest, extra_meta: dict | None,
    stale: list[Element] | None = None,
) -> None:
    """Updates the question in place with the re-asked options and skips its older duplicates."""
    meta = {
        "options": _options_meta(request), "kind": request.kind,
        "diagram_requested": False, "revised": False,
        "allow_custom": request.allow_custom, "allow_skip": request.allow_skip,
        "session_id": request.session_id, "total": request.total,
        "degraded": False, "validation": None,
        **(extra_meta or {}),
    }
    ops: list[dict] = [
        {
            "op": "update_element", "id": old.id,
            "meta": {"state": "skipped", "answer": None, "option_id": None},
        }
        for old in stale or []
    ]
    question_id = element.meta["question_id"]
    _commit(ws, lambda doc: [
        *ops,
        {"op": "update_element", "id": element.id, "label": request.question, "meta": meta},
        *_adopt_ops(doc, request, question_id),
    ])


def request_diagram(ws: Workspace, element: Element, requested_at: str) -> None:
    """Records the user's "Add diagram" request on the element's meta."""
    meta = {
        "diagram_requested": True, "diagram_requested_at": requested_at,
        "diagram_requests": int(element.meta.get("diagram_requests") or 0) + 1,
    }
    _commit(ws, lambda _doc: [{"op": "update_element", "id": element.id, "meta": meta}])


def _question_in(doc: CanvasDoc, question_id: str) -> Element:
    for element in doc.elements.values():
        if element.render == "question" and element.meta.get("question_id") == question_id:
            return element
    raise QuestionWriteError(f"unknown question {question_id!r}")


def _next_top(doc: CanvasDoc, layer: str) -> float:
    """The y just below the question's own diagrams, else below every per-question diagram."""
    def bottoms(match: Callable[[str], bool]) -> list[float]:
        return [
            e.position.y + (e.size.h / 2 if e.size else 0) for e in doc.elements.values()
            if match(e.layer)
        ]

    found = bottoms(lambda candidate: candidate == layer) or bottoms(
        lambda candidate: candidate.startswith(diagrams.LAYER_PREFIX)
    )
    return max(found) + diagrams.GAP if found else 0


def draw_diagram(
    ws: Workspace, title: str, nodes: list[diagrams.DiagramNode],
    edges: list[diagrams.DiagramEdge], question_id: str | None, option_id: str | None,
) -> str:
    """Draws one option diagram on its `decisions/<question_id>` layer; returns its root id."""
    with canvas_lock(ws.id):
        doc = CanvasDoc.load(ws.canvas_core_path, ws.diagrams_root)
        target = None
        if question_id:
            target = _question_in(doc, question_id)
            if option_id not in {o["id"] for o in target.meta.get("options", [])}:
                raise QuestionWriteError(f"unknown option {option_id!r} on that question")
        layer = diagrams.layer_for(question_id, uuid.uuid4().hex[:8])
        ops = diagrams.diagram_ops(title, nodes, edges, _next_top(doc, layer), option_id, layer)
        result = apply_batch(doc, ops, explanation="ai question")
        if result.ok and target is not None:
            assert result.doc is not None
            root_id = result.id_map["root"]
            options = [
                {**o, "diagram_ref": root_id} if o["id"] == option_id else o
                for o in target.meta.get("options", [])
            ]
            attach = [{"op": "update_element", "id": target.id, "meta": {"options": options}}]
            second = apply_batch(result.doc, attach, explanation="ai question")
            result = (
                BatchResult(
                    ok=True, doc=second.doc, id_map=result.id_map,
                    affected=sorted({*result.affected, *second.affected}),
                )
                if second.ok else second
            )
        response = commit_canvas_batch(ws, result)
    if not response["ok"]:
        raise QuestionWriteError(str(response["errors"]))
    return response["id_map"]["root"]
