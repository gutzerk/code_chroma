"""GET/POST /repos/{id}/questions and /agents/{id}/questions: the user's side of `ask_user`."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from codechroma.bridge.agents.manager import UnknownAgentError
from codechroma.bridge.deps import Services, Ws
from codechroma.bridge.services import BridgeServices
from codechroma.bridge.workspaces import Workspace
from codechroma.canvas.document import Element
from codechroma.questions import agent_view, delivery, store
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


def _find_element(ws: Workspace, question_id: str, agent_id: str | None = None) -> Element:
    """The question by id; with an agent scope only one that agent asked, never a neighbour's."""
    element = store.find_element(ws, question_id)
    if element is None or (agent_id is not None and element.meta.get("agent_id") != agent_id):
        raise HTTPException(status_code=404, detail="unknown question")
    return element


def _open_element(ws: Workspace, question_id: str, agent_id: str | None = None) -> Element:
    element = _find_element(ws, question_id, agent_id)
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
    if not mcp.authorizes(request.headers, repo_id):
        raise HTTPException(status_code=401, detail="invalid or missing workspace token")
    # `degraded` is server-side only (as in C#): a caller-sent flag must not skip validation.
    body = body.model_copy(update={"degraded": False})
    try:
        return await mcp.ask(repo_id, body)
    except QuestionRejected as rejected:
        raise HTTPException(status_code=422, detail=str(rejected)) from rejected


async def _answer(
    ws: Workspace, services: BridgeServices, question_id: str, body: AnswerBody,
    agent_id: str | None = None,
) -> dict:
    element = await run_in_threadpool(_open_element, ws, question_id, agent_id)
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
    settled = await run_in_threadpool(store.settle, ws, element, "answered", result)
    waiting = await delivery.deliver_settled(services, ws, settled)
    await agent_view.announce(services, element.meta.get("agent_id"))
    return _ack(question_id, "answered", text, waiting)


async def _skip(
    ws: Workspace, services: BridgeServices, question_id: str, agent_id: str | None = None
) -> dict:
    element = await run_in_threadpool(_open_element, ws, question_id, agent_id)
    if not element.meta.get("allow_skip", True):
        raise HTTPException(status_code=422, detail="this question cannot be skipped")
    result = QuestionResult(skipped=True)
    settled = await run_in_threadpool(store.settle, ws, element, "skipped", result)
    waiting = await delivery.deliver_settled(services, ws, settled)
    await agent_view.announce(services, element.meta.get("agent_id"))
    return _ack(question_id, "skipped", None, waiting)


async def _request_diagram(
    ws: Workspace, services: BridgeServices, question_id: str, agent_id: str | None = None
) -> dict:
    element = await run_in_threadpool(_open_element, ws, question_id, agent_id)
    options = element.meta.get("options", [])
    if not options:
        raise HTTPException(status_code=422, detail="this question has no options")
    if all(o.get("diagram_ref") for o in options):
        raise HTTPException(status_code=422, detail="every option already has a diagram")
    if not element.meta.get("diagram_requested"):
        await run_in_threadpool(
            store.request_diagram, ws, element, datetime.now(UTC).isoformat()
        )
        await agent_view.announce(services, element.meta.get("agent_id"))
    waiting = delivery.deliver(services, element, delivery.diagram_request_message(element))
    return _ack(question_id, "open", None, waiting)


async def _revise(
    ws: Workspace, services: BridgeServices, question_id: str, agent_id: str | None = None
) -> dict:
    element = await run_in_threadpool(_find_element, ws, question_id, agent_id)
    removed = await run_in_threadpool(store.reopen, ws, element)
    await agent_view.announce(services, element.meta.get("agent_id"))
    return {**_ack(question_id, "open", None, False), "removed": removed}


@router.post("/repos/{repo_id}/questions/{question_id}/answer")
async def answer_question(ws: Ws, services: Services, question_id: str, body: AnswerBody) -> dict:
    """Records the answer; the agent is woken once its last open question settles."""
    return await _answer(ws, services, question_id, body)


@router.post("/repos/{repo_id}/questions/{question_id}/skip")
async def skip_question(ws: Ws, services: Services, question_id: str) -> dict:
    """Marks the question skipped; the agent then decides itself once its batch completes."""
    return await _skip(ws, services, question_id)


@router.post("/repos/{repo_id}/questions/{question_id}/request-diagram")
async def request_diagram(ws: Ws, services: Services, question_id: str) -> dict:
    """Records an "Add diagram" request and types it into the asking agent's terminal."""
    return await _request_diagram(ws, services, question_id)


@router.post("/repos/{repo_id}/questions/{question_id}/revise")
async def revise_question(ws: Ws, services: Services, question_id: str) -> dict:
    """Reopens a settled question and deletes the later steps of the same session."""
    return await _revise(ws, services, question_id)


def _known_agent(services: BridgeServices, agent_id: str) -> None:
    try:
        services.agent_manager.get(agent_id)
    except UnknownAgentError as exc:
        raise HTTPException(status_code=404, detail=f"unknown agent: {agent_id}") from exc


async def _agent_workspace(services: BridgeServices, agent_id: str) -> Workspace:
    """404 for an unknown agent, else the workspace its ask_user writes to (built off the loop)."""
    _known_agent(services, agent_id)
    return await asyncio.to_thread(services.registry.get, agent_id)


@router.get("/agents/{agent_id}/questions")
async def agent_questions(agent_id: str, services: Services) -> dict:
    """The agent window's source: open questions, history and option diagrams, bridge-resolved."""
    _known_agent(services, agent_id)
    return await asyncio.to_thread(agent_view.read, services.registry, agent_id)


@router.post("/agents/{agent_id}/questions/{question_id}/answer")
async def answer_agent_question(
    agent_id: str, question_id: str, body: AnswerBody, services: Services
) -> dict:
    """`answer` by agent id, in the workspace the agent asks into."""
    ws = await _agent_workspace(services, agent_id)
    return await _answer(ws, services, question_id, body, agent_id)


@router.post("/agents/{agent_id}/questions/{question_id}/skip")
async def skip_agent_question(agent_id: str, question_id: str, services: Services) -> dict:
    """`skip` by agent id."""
    return await _skip(await _agent_workspace(services, agent_id), services, question_id, agent_id)


@router.post("/agents/{agent_id}/questions/{question_id}/request-diagram")
async def request_agent_question_diagram(
    agent_id: str, question_id: str, services: Services
) -> dict:
    """`request-diagram` by agent id."""
    ws = await _agent_workspace(services, agent_id)
    return await _request_diagram(ws, services, question_id, agent_id)


@router.post("/agents/{agent_id}/questions/{question_id}/revise")
async def revise_agent_question(agent_id: str, question_id: str, services: Services) -> dict:
    """`revise` by agent id."""
    ws = await _agent_workspace(services, agent_id)
    return await _revise(ws, services, question_id, agent_id)
