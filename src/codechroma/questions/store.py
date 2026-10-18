"""Reads and writes `question` elements through the one canvas write point (`apply_batch`)."""

from __future__ import annotations

import uuid

from codechroma.bridge.workspaces import Workspace
from codechroma.canvas.apply_batch import BatchResult, apply_batch
from codechroma.canvas.document import CanvasDoc, Element
from codechroma.canvas.locks import canvas_lock
from codechroma.questions.models import AskRequest, QuestionResult


class QuestionWriteError(RuntimeError):
    """The canvas rejected or failed to save a question write."""


def commit_canvas_batch(ws: Workspace, result: BatchResult) -> dict:
    """Lazy proxy: importing bridge.routes at module load would cycle through its routers."""
    from codechroma.bridge.routes._canvas_write import commit_canvas_batch as commit

    return commit(ws, result)


def _commit(ws: Workspace, ops: list[dict]) -> dict:
    with canvas_lock(ws.id):
        doc = CanvasDoc.load(ws.canvas_core_path, ws.diagrams_root)
        response = commit_canvas_batch(ws, apply_batch(doc, ops, explanation="ai question"))
    if not response["ok"]:
        raise QuestionWriteError(str(response["errors"]))
    return response


def _next_step(doc: CanvasDoc, session_id: str | None) -> int:
    if not session_id:
        return 1
    seen = [e for e in doc.elements.values() if _meta_of(e).get("session_id") == session_id]
    return len(seen) + 1


def _meta_of(element: Element) -> dict:
    return element.meta if element.render == "question" else {}


def open_question(ws: Workspace, request: AskRequest) -> tuple[str, str]:
    """Adds the `question` element; returns (question_id, element_id)."""
    question_id = uuid.uuid4().hex
    with canvas_lock(ws.id):
        doc = CanvasDoc.load(ws.canvas_core_path, ws.diagrams_root)
        step = _next_step(doc, request.session_id)
        meta = {
            "question_id": question_id,
            "session_id": request.session_id,
            "step": step,
            "total": request.total,
            "kind": request.kind,
            "state": "open",
            "answer": None,
            "option_id": None,
            "allow_custom": request.allow_custom,
            "allow_skip": request.allow_skip,
            "agent_id": request.agent_id,
            "options": [option.model_dump() for option in request.options],
        }
        op = {
            "op": "add_element", "temp_id": "q", "render": "question", "layer": "questions",
            "label": request.question, "meta": meta,
        }
        response = commit_canvas_batch(ws, apply_batch(doc, [op], explanation="ai question"))
    if not response["ok"]:
        raise QuestionWriteError(str(response["errors"]))
    return question_id, response["id_map"]["q"]


def find_element(ws: Workspace, question_id: str) -> Element | None:
    """The `question` element carrying this id, or None."""
    doc = CanvasDoc.load(ws.canvas_core_path, ws.diagrams_root)
    for element in doc.elements.values():
        if element.render == "question" and element.meta.get("question_id") == question_id:
            return element
    return None


def list_questions(ws: Workspace) -> list[Element]:
    """Every `question` element, oldest first by step order of insertion."""
    doc = CanvasDoc.load(ws.canvas_core_path, ws.diagrams_root)
    return [e for e in doc.elements.values() if e.render == "question"]


def settle(ws: Workspace, element_id: str, state: str, result: QuestionResult) -> None:
    """Writes the answered/skipped state onto the element's meta."""
    meta = {"state": state, "answer": result.answer, "option_id": result.option_id}
    _commit(ws, [{"op": "update_element", "id": element_id, "meta": meta}])


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
        "meta": {"state": "open", "answer": None, "option_id": None},
    })
    _commit(ws, ops)
    return later
