"""GET/POST /repos/{id}/questions -- the user's side of an agent's `ask_user` call."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from codechroma.bridge.deps import Services, Ws
from codechroma.canvas.document import Element
from codechroma.questions import delivery, store
from codechroma.questions.launch import bearer_token
from codechroma.questions.mcp_server import QuestionAuthError
from codechroma.questions.models import AskRequest, QuestionResult
from codechroma.questions.validation import QuestionRejected

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


async def _deliver(ws: Ws, services: Services, question_id: str) -> bool:
    """Re-reads the settled element and types its answer line into the agent; True if live."""
    settled = await run_in_threadpool(_find_element, ws, question_id)
    return delivery.deliver(services, settled)


def _open_element(ws: Ws, question_id: str) -> Element:
    element = _find_element(ws, question_id)
    if element.meta.get("state") != "open":
        raise HTTPException(status_code=409, detail="question is already settled")
    return element


@router.get("/repos/{repo_id}/questions")
def list_open_questions(ws: Ws, services: Services) -> dict:
    """Open questions with `waiting`: true while a live agent session will receive the answer."""
    return {"questions": [
        _view(e, delivery.live_session(services, e) is not None)
        for e in store.list_questions(ws) if e.meta.get("state") == "open"
    ]}


@router.post("/repos/{repo_id}/questions/ask")
async def ask_question(repo_id: str, request: Request, body: AskRequest) -> dict:
    """Non-blocking ask for non-MCP callers (the AskUserQuestion hook); same bearer as /mcp."""
    mcp = request.app.state.question_mcp
    try:
        authorized = mcp.workspace_id_for(bearer_token(request.headers)) == repo_id
    except QuestionAuthError:
        authorized = False
    if not authorized:
        raise HTTPException(status_code=401, detail="invalid or missing workspace token")
    try:
        return await mcp.ask(repo_id, body)
    except QuestionRejected as rejected:
        raise HTTPException(status_code=422, detail=str(rejected)) from rejected


@router.post("/repos/{repo_id}/questions/{question_id}/answer")
async def answer_question(ws: Ws, services: Services, question_id: str, body: AnswerBody) -> dict:
    """Records the answer on the element, then types it into the asking agent's terminal."""
    element = await run_in_threadpool(_open_element, ws, question_id)
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
    result = QuestionResult(answer=text, option_id=option_id)
    await run_in_threadpool(store.settle, ws, element.id, "answered", result)
    return _ack(question_id, "answered", text, await _deliver(ws, services, question_id))


@router.post("/repos/{repo_id}/questions/{question_id}/skip")
async def skip_question(ws: Ws, services: Services, question_id: str) -> dict:
    """Marks the question skipped and tells the asking agent to decide itself."""
    element = await run_in_threadpool(_open_element, ws, question_id)
    if not element.meta.get("allow_skip", True):
        raise HTTPException(status_code=422, detail="this question cannot be skipped")
    await run_in_threadpool(store.settle, ws, element.id, "skipped", QuestionResult(skipped=True))
    return _ack(question_id, "skipped", None, await _deliver(ws, services, question_id))


@router.post("/repos/{repo_id}/questions/{question_id}/request-diagram")
async def request_diagram(ws: Ws, services: Services, question_id: str) -> dict:
    """Records an "Add diagram" request and types it into the asking agent's terminal."""
    element = await run_in_threadpool(_open_element, ws, question_id)
    options = element.meta.get("options", [])
    if not options:
        raise HTTPException(status_code=422, detail="this question has no options")
    if all(o.get("diagram_ref") for o in options):
        raise HTTPException(status_code=422, detail="every option already has a diagram")
    if not element.meta.get("diagram_requested"):
        await run_in_threadpool(
            store.request_diagram, ws, element, datetime.now(UTC).isoformat()
        )
    waiting = delivery.deliver(services, element, delivery.diagram_request_message(element))
    return _ack(question_id, "open", None, waiting)


@router.post("/repos/{repo_id}/questions/{question_id}/revise")
def revise_question(ws: Ws, services: Services, question_id: str) -> dict:
    """Reopens a settled question and deletes the later steps of the same session."""
    removed = store.reopen(ws, _find_element(ws, question_id))
    return {**_ack(question_id, "open", None, False), "removed": removed}
