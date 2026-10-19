"""GET/POST /repos/{id}/questions -- the user's side of an agent's `ask_user` call."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from codechroma.bridge.deps import Services, Ws
from codechroma.canvas.document import Element
from codechroma.questions import store
from codechroma.questions.launch import bearer_token
from codechroma.questions.mcp_server import QuestionAuthError
from codechroma.questions.models import AskRequest, QuestionResult

router = APIRouter()


class AnswerBody(BaseModel):
    """`answer` is free text; `option_id` picks a card (the answer then defaults to its title)."""

    answer: str | None = None
    option_id: str | None = None


def _view(element: Element, waiting: bool) -> dict:
    return {
        "element_id": element.id, "question": element.label, "waiting": waiting, **element.meta,
    }


def _ack(question_id: str, state: str, answer: str | None, waiting: bool) -> dict:
    ack = {"ok": True, "question_id": question_id, "state": state, "waiting": waiting}
    return ack if answer is None else {**ack, "answer": answer}


def _find_element(ws: Ws, question_id: str) -> Element:
    element = store.find_element(ws, question_id)
    if element is None:
        raise HTTPException(status_code=404, detail="unknown question")
    return element


def _open_element(ws: Ws, question_id: str) -> Element:
    element = _find_element(ws, question_id)
    if element.meta.get("state") != "open":
        raise HTTPException(status_code=409, detail="question is already settled")
    return element


@router.get("/repos/{repo_id}/questions")
def list_open_questions(ws: Ws, services: Services) -> dict:
    """Open questions with `waiting`: false when no agent call is blocked on it any more."""
    return {"questions": [
        _view(e, services.questions.is_waiting(e.meta.get("question_id", "")))
        for e in store.list_questions(ws) if e.meta.get("state") == "open"
    ]}


@router.post("/repos/{repo_id}/questions/ask")
async def ask_question(repo_id: str, request: Request, body: AskRequest) -> dict:
    """Blocking ask for non-MCP callers (the AskUserQuestion hook); same bearer token as /mcp."""
    mcp = request.app.state.question_mcp
    try:
        authorized = mcp.workspace_id_for(bearer_token(request.headers)) == repo_id
    except QuestionAuthError:
        authorized = False
    if not authorized:
        raise HTTPException(status_code=401, detail="invalid or missing workspace token")
    return await mcp.ask(repo_id, body)


@router.post("/repos/{repo_id}/questions/{question_id}/answer")
def answer_question(ws: Ws, services: Services, question_id: str, body: AnswerBody) -> dict:
    """Records the answer on the element, then wakes the waiting agent if there is one."""
    element = _open_element(ws, question_id)
    text, option_id = (body.answer or "").strip(), body.option_id
    if option_id is not None:
        option = next((o for o in element.meta.get("options", []) if o["id"] == option_id), None)
        if option is None:
            raise HTTPException(status_code=422, detail="unknown option_id")
        text = text or option["title"]
    elif not element.meta.get("allow_custom", True):
        raise HTTPException(status_code=422, detail="this question takes no custom answer")
    if not text:
        raise HTTPException(status_code=422, detail="answer is empty")
    store.settle(ws, element.id, "answered", QuestionResult(answer=text, option_id=option_id))
    waiting = services.questions.answer(question_id, text, option_id)
    return _ack(question_id, "answered", text, waiting)


@router.post("/repos/{repo_id}/questions/{question_id}/skip")
def skip_question(ws: Ws, services: Services, question_id: str) -> dict:
    """Marks the question skipped and wakes the waiting agent with `skipped: true`."""
    element = _open_element(ws, question_id)
    if not element.meta.get("allow_skip", True):
        raise HTTPException(status_code=422, detail="this question cannot be skipped")
    store.settle(ws, element.id, "skipped", QuestionResult(skipped=True))
    return _ack(question_id, "skipped", None, services.questions.skip(question_id))


@router.post("/repos/{repo_id}/questions/{question_id}/revise")
def revise_question(ws: Ws, services: Services, question_id: str) -> dict:
    """Reopens a settled question and deletes the later steps of the same session."""
    removed = store.reopen(ws, _find_element(ws, question_id))
    services.questions.forget(question_id)
    return {**_ack(question_id, "open", None, False), "removed": removed}
