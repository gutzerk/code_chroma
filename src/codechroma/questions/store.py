"""Reads and writes `question` elements through the one canvas write point (`apply_batch`)."""

from __future__ import annotations

import uuid
from collections.abc import Callable

from codechroma.bridge.workspaces import Workspace
from codechroma.canvas.apply_batch import BatchResult, apply_batch
from codechroma.canvas.document import CanvasDoc, Element
from codechroma.canvas.locks import canvas_lock
from codechroma.questions import diagrams
from codechroma.questions.models import AskRequest, QuestionResult


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


def _next_step(doc: CanvasDoc, session_id: str | None) -> int:
    if not session_id:
        return 1
    return 1 + sum(
        1 for e in doc.elements.values()
        if e.render == "question" and e.meta.get("session_id") == session_id
    )


def _options_meta(request: AskRequest) -> list[dict]:
    return [option.model_dump() for option in request.options]


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
            "step": _next_step(doc, request.session_id),
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


def settle(ws: Workspace, element_id: str, state: str, result: QuestionResult) -> None:
    """Writes the answered/skipped state onto the element's meta."""
    meta = {"state": state, "answer": result.answer, "option_id": result.option_id}
    _commit(ws, lambda _doc: [{"op": "update_element", "id": element_id, "meta": meta}])


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
        "options": _options_meta(request), "kind": request.kind, "diagram_requested": False,
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


def _next_top(doc: CanvasDoc) -> float:
    """The y just below every existing per-question diagram element (0 when there is none)."""
    bottoms = [
        e.position.y + (e.size.h / 2 if e.size else 0) for e in doc.elements.values()
        if e.layer.startswith(diagrams.LAYER_PREFIX)
    ]
    return max(bottoms) + diagrams.GAP if bottoms else 0


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
        ops = diagrams.diagram_ops(title, nodes, edges, _next_top(doc), option_id, layer)
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
