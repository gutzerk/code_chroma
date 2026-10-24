"""The `ask_user` contract: field checks, the rejection text and the per-agent retry counter."""

from __future__ import annotations

import time
from collections.abc import Callable, Iterable

from codechroma.questions.models import AskRequest

MIN_OPTIONS = 2
MAX_OPTIONS = 4
RESET_AFTER_SECONDS = 600.0
MAX_TRACKED = 1000
_REQUIRED_TEXT = ("title", "description", "pro", "con", "why")
_FOOTER = (
    "Call ask_user again with all fields. Keep the original intent and options. "
    "Do not ask in terminal text."
)


class QuestionRejected(ValueError):
    """The `ask_user` call broke the contract; the message is the tool error the agent reads."""


def validate_ask(request: AskRequest) -> list[str]:
    """One line per contract problem; empty when the question may be shown."""
    problems: list[str] = []
    if not request.question.strip():
        problems.append("question is empty")
    options = request.options
    if not MIN_OPTIONS <= len(options) <= MAX_OPTIONS:
        problems.append(f"give {MIN_OPTIONS}-{MAX_OPTIONS} options, got {len(options)}")
    ids = [option.id for option in options]
    if len(set(ids)) != len(ids):
        problems.append("option ids are not unique")
    for option in options:
        for name in _REQUIRED_TEXT:
            if not getattr(option, name).strip():
                problems.append(f'Option "{option.title or option.id}": missing {name}')
    ranks = [option.rank for option in options]
    if ranks.count(1) != 1:
        problems.append("exactly one option must have rank 1")
    given = [rank for rank in ranks if rank is not None]
    if len(set(given)) != len(given):
        problems.append("ranks are not unique")
    if request.kind == "diagram" and not any(option.diagram_ref for option in options):
        problems.append('kind "diagram" needs a diagram_ref on at least one option')
    return problems


def unknown_refs(request: AskRequest, known_ids: Iterable[str]) -> list[str]:
    """One line per `diagram_ref` that names no canvas element."""
    known = set(known_ids)
    return [
        f'Option "{option.title or option.id}": diagram_ref {option.diagram_ref!r} is unknown'
        for option in request.options
        if option.diagram_ref and option.diagram_ref not in known
    ]


def rejection_text(problems: list[str], subject: str = "question") -> str:
    """The fixed-shape tool error: header, one bullet per problem, then the footer."""
    lines = [f"CodeChroma rejected the {subject}.", *(f"- {p}" for p in problems), _FOOTER]
    return "\n".join(lines)


class RejectionTracker:
    """Counts consecutive rejections per (workspace, session); a None session is never tracked."""

    def __init__(
        self, clock: Callable[[], float] = time.monotonic, max_entries: int = MAX_TRACKED
    ) -> None:
        self._clock = clock
        self._max_entries = max_entries
        self._entries: dict[tuple[str, str], tuple[int, float]] = {}

    def count(self, workspace_id: str, session_id: str | None) -> int:
        """Rejections so far; zero once the entry has been silent for ten minutes."""
        entry = self._entries.get((workspace_id, session_id)) if session_id else None
        if entry is None or self._clock() - entry[1] > RESET_AFTER_SECONDS:
            return 0
        return entry[0]

    def record(self, workspace_id: str, session_id: str | None) -> None:
        """Counts one more rejection; untracked without a session id."""
        if not session_id:
            return
        total = self.count(workspace_id, session_id) + 1
        self._evict()
        self._entries[(workspace_id, session_id)] = (total, self._clock())

    def reset(self, workspace_id: str, session_id: str | None) -> None:
        """Forgets the count after a valid question, an answer or a degraded pass-through."""
        self._entries.pop((workspace_id, session_id), None)

    def _evict(self) -> None:
        now = self._clock()
        for key in [k for k, (_, at) in self._entries.items() if now - at > RESET_AFTER_SECONDS]:
            del self._entries[key]
        while len(self._entries) >= self._max_entries:
            del self._entries[next(iter(self._entries))]
