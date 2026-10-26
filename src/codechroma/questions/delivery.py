"""Types a user's answer into the asking agent's terminal as its next message."""

from __future__ import annotations

from typing import Any

from codechroma.canvas.document import Element
from codechroma.config import settings

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
