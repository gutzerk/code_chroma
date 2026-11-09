"""One agent's questions as its window shows them, and the `agent-questions` push on change."""

from __future__ import annotations

import asyncio
import logging
from collections import deque
from typing import Any

from codechroma.bridge.workspaces import WorkspaceRegistry
from codechroma.canvas.document import CanvasDoc, Element
from codechroma.questions import store

logger = logging.getLogger(__name__)

AGENT_QUESTIONS_EVENT = "agent-questions"
# The most elements one option diagram contributes, the cap the window's renderer walks with.
MAX_DIAGRAM_NODES = 40


def _load(registry: WorkspaceRegistry, agent_id: str) -> tuple[str, CanvasDoc]:
    """The workspace the agent's ask_user writes to (its token's mapping) and its canvas."""
    workspace, root = registry.resolve(agent_id)
    base = root / ".codechroma"
    return workspace, CanvasDoc.load(base / "canvas-core.json", base / "diagrams")


def _is_open(element: Element) -> bool:
    return element.meta.get("state", "open") in ("open", None)


def _open_questions(doc: CanvasDoc, agent_id: str) -> list[Element]:
    found = [
        e for e in doc.elements.values()
        if e.render == "question" and e.meta.get("agent_id") == agent_id and _is_open(e)
    ]
    return sorted(found, key=lambda e: float(e.meta.get("step") or 0))


def _subgraph(doc: CanvasDoc, root_id: str) -> list[str]:
    """The option diagram's root, group members and arrow targets, in the window's walk order."""
    if root_id not in doc.elements:
        return []
    seen, queue = [root_id], deque([root_id])
    while queue and len(seen) < MAX_DIAGRAM_NODES:
        current = queue.popleft()
        reached = [e.to for e in doc.edges.values() if e.from_ == current] + [
            e.id for e in doc.elements.values() if e.group_id == current
        ]
        for node in reached:
            if node in doc.elements and node not in seen and len(seen) < MAX_DIAGRAM_NODES:
                seen.append(node)
                queue.append(node)
    return seen


def read(registry: WorkspaceRegistry, agent_id: str) -> dict[str, Any]:
    """GET /agents/{id}/questions: open questions, session history and option diagrams as a doc."""
    workspace, doc = _load(registry, agent_id)
    open_questions = _open_questions(doc, agent_id)
    sessions = {s for q in open_questions if (s := q.meta.get("session_id"))}
    keep = {q.id for q in open_questions} | {
        e.id for e in doc.elements.values()
        if e.render == "question" and not _is_open(e) and e.meta.get("agent_id") == agent_id
        and e.meta.get("session_id") in sessions
    }
    diagram: set[str] = set()
    for question in open_questions:
        for option in question.meta.get("options") or []:
            if ref := option.get("diagram_ref"):
                diagram.update(_subgraph(doc, ref))
    keep |= diagram
    return {
        "agent_id": agent_id,
        "workspace": workspace,
        "open_questions": len(open_questions),
        "elements": {
            i: e.model_dump(by_alias=True) for i, e in doc.elements.items() if i in keep
        },
        "edges": {
            i: e.model_dump(by_alias=True) for i, e in doc.edges.items()
            if e.from_ in diagram and e.to in diagram
        },
    }


def open_count(registry: WorkspaceRegistry, agent_id: str) -> int:
    """How many questions the agent has open in the workspace it asks into."""
    return len(_open_questions(_load(registry, agent_id)[1], agent_id))


def has_any(registry: WorkspaceRegistry, agent_id: str) -> bool:
    """Whether any question carries this id, read from disk so no workspace is brought up."""
    return bool(store.agent_questions_in(_load(registry, agent_id)[1], agent_id))


def forget_leftovers(registry: WorkspaceRegistry, agent_id: str) -> None:
    """A new agent may reuse a closed agent's id: drops its leftover questions; never raises."""
    try:
        if has_any(registry, agent_id):
            store.forget_agent(registry.get(agent_id), agent_id)
    except Exception:
        logger.exception("questions: could not clear the leftover questions of agent %s", agent_id)


async def announce(services: Any, agent_id: str | None) -> None:
    """Pushes `agent-questions` with the agent's open count to every canvas; never raises."""
    if not agent_id:
        return
    try:
        count = await asyncio.to_thread(open_count, services.registry, agent_id)
        await services.connections.broadcast(
            {"type": AGENT_QUESTIONS_EVENT, "id": agent_id, "open_questions": count}
        )
    except Exception:
        logger.exception("questions: could not announce the questions of agent %s", agent_id)
