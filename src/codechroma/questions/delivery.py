"""Types the user's answers into the asking agent's terminal, once per completed batch."""

from __future__ import annotations

import asyncio
from typing import Any

from starlette.concurrency import run_in_threadpool

from codechroma.bridge.workspaces import Workspace
from codechroma.canvas.document import Element
from codechroma.config import settings
from codechroma.questions import store

SKIPPED = "skipped by the user, decide yourself"
DIAGRAM_REQUEST = (
    "the user wants a diagram for each option: draw them with draw_option_diagram, "
    "then call ask_user again with the same session_id and question"
)


def _one_line(value: object) -> str:
    """Control characters would be keystrokes in the PTY, so collapse them into spaces."""
    spaced = "".join(" " if c < " " or "\x7f" <= c <= "\x9f" else c for c in str(value or ""))
    return " ".join(spaced.split())


def _header(kind: str, element: Element) -> str:
    step, total = element.meta.get("step") or 1, element.meta.get("total")
    position = f"Q{step}/{total}" if total else f"Q{step}"
    return f"[CodeChroma {kind} · {position} · {element.meta.get('question_id')}]"


def answer_message(element: Element) -> str:
    """The line typed into the agent for a settled question (answer, skip or changed answer)."""
    if element.meta.get("state") == "skipped":
        outcome = SKIPPED
    elif element.meta.get("revised"):
        outcome = f"changed answer: {element.meta.get('answer')}"
    else:
        outcome = str(element.meta.get("answer"))
    return _one_line(f"{_header('answer', element)} {element.label} → {outcome}")


def diagram_request_message(element: Element) -> str:
    """The line typed into the agent when the user presses "Add diagram"."""
    return _one_line(f"{_header('request', element)} {element.label} → {DIAGRAM_REQUEST}")


def batch_message(batch: list[Element]) -> str:
    """Every settled answer of one batch as one line, in the order the agent asked them."""
    return " ".join(answer_message(element) for element in batch)


def live_session(services: Any, element: Element) -> Any | None:
    """The running agent session that asked this question, or None."""
    agent_id = element.meta.get("agent_id")
    session = services.agent_sessions.get(agent_id) if agent_id else None
    return session if session is not None and session.is_alive else None


def deliver(services: Any, element: Element, text: str | None = None) -> bool:
    """Queues the answer for the asking agent; True when a live session will receive it."""
    session = live_session(services, element)
    if session is None:
        return False
    session.inject_when_idle(
        text or answer_message(element), attempts=settings.questions.answer_inject_attempts
    )
    return True


# Follow-up tasks that clear or release a typed batch; held so the loop never drops them early.
_follow_ups: set[asyncio.Task] = set()


async def deliver_settled(services: Any, ws: Workspace, element: Element) -> bool:
    """Once the agent has no open question, types the batch, then clears it; True if it is live."""
    session = live_session(services, element)
    if session is None:
        return False
    batch = await run_in_threadpool(store.take_batch, ws, element.meta["agent_id"])
    if batch:
        typing = session.inject_when_idle(
            batch_message(batch), attempts=settings.questions.answer_inject_attempts
        )
        follow_up = asyncio.ensure_future(_clear_once_typed(ws, batch, typing))
        _follow_ups.add(follow_up)
        follow_up.add_done_callback(_follow_ups.discard)
    return True


async def _clear_once_typed(ws: Workspace, batch: list[Element], typing: Any) -> None:
    """Only a typed batch leaves the canvas; an untyped one stays for ask_user_result."""
    typed = await typing
    await run_in_threadpool(store.clear_batch if typed else store.release_batch, ws, batch)
