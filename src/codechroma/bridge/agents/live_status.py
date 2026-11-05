"""One live agent session's status: screen verdicts, hook reports, done/unread and permissions.

Mirrors `dotnet/CodeChroma.Bridge/Agents/AgentStatusState.cs`. Until the first hook report the
screen detector decides idle/working/blocked; from then on hooks own working and idle and the
screen may only raise `blocked` for a visible dialog. `done` is idle nobody has looked at since.
"""

from __future__ import annotations

import secrets
import threading
from concurrent.futures import Future
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from codechroma.bridge.skill_output import flatten
from codechroma.io import iso, utc_now

# Every status an agent card reports: idle/working/blocked/done live, stopped or error once gone.
STATUS_IDLE = "idle"
STATUS_WORKING = "working"
STATUS_BLOCKED = "blocked"
STATUS_DONE = "done"
STATUS_STOPPED = "stopped"
STATUS_ERROR = "error"
TARGET_LIMIT = 120
# The tool_input keys a target is read from, in order; agent_hook.TARGET_KEYS forwards the same.
TARGET_KEYS = ("file_path", "command", "pattern", "url")


@dataclass(frozen=True)
class AgentActivity:
    """What a working agent is doing: the PreToolUse tool, its short argument, the turn start."""

    tool: str | None
    target: str | None
    turn_started_at: datetime

    def to_json(self) -> dict:
        started = iso(self.turn_started_at)
        return {"tool": self.tool, "target": self.target, "turn_started_at": started}


@dataclass(frozen=True)
class PendingPermission:
    """A PermissionRequest hook waiting for the canvas to allow or deny it."""

    request_id: str
    tool: str
    summary: str
    at: datetime

    def to_json(self) -> dict:
        return {
            "request_id": self.request_id, "tool": self.tool,
            "summary": self.summary, "at": iso(self.at),
        }


@dataclass(frozen=True)
class AgentError:
    """Why an agent is in the error state: a non-zero exit or a failed start."""

    message: str
    at: datetime

    def to_json(self) -> dict:
        return {"message": self.message, "at": iso(self.at)}


@dataclass(frozen=True)
class StatusSnapshot:
    """A copy of the live status fields taken under the state's lock; error only for `error`."""

    status: str
    since: datetime
    activity: AgentActivity | None
    pending: PendingPermission | None
    error: AgentError | None = None

    def to_json(self) -> dict:
        """The five status fields every agent payload and `agent-status` event carry."""
        working = self.status == STATUS_WORKING and self.activity is not None
        return {
            "status": self.status,
            "status_since": iso(self.since),
            "activity": self.activity.to_json() if working and self.activity else None,
            "pending_permission": self.pending.to_json() if self.pending is not None else None,
            "error": self.error.to_json() if self.error is not None else None,
        }


@dataclass(frozen=True)
class HookOutcome:
    """What one hook report did; a PermissionRequest also carries the decision future to wait on."""

    changed: bool
    request_id: str | None = None
    decision: Future | None = None


def hook_target(tool_input: Any) -> str | None:
    """The short argument a tool call is about, single-line and at most 120 chars."""
    if not isinstance(tool_input, dict):
        return None
    for key in TARGET_KEYS:
        raw = tool_input.get(key)
        if isinstance(raw, str) and raw:
            return flatten(raw, TARGET_LIMIT)
    return None


class AgentStatusState:
    """Thread-safe: the poller samples the screen off the loop while hooks arrive on it."""

    def __init__(self, clock=utc_now) -> None:
        self._clock = clock
        self._lock = threading.Lock()
        self._live = STATUS_IDLE
        self._unread = False
        self._hooked = False
        self._screen_blocker = False
        self._activity: AgentActivity | None = None
        self._pending: PendingPermission | None = None
        self._waiter: Future | None = None
        self._since: datetime | None = None

    @property
    def live(self) -> str:
        """The detector-side status (idle, working or blocked) the screen rules should hold."""
        with self._lock:
            return self._live

    @property
    def hooked(self) -> bool:
        """Whether a hook reported: from then on the screen no longer decides working or idle."""
        with self._lock:
            return self._hooked

    def snapshot(self) -> StatusSnapshot:
        with self._lock:
            if self._since is None:
                self._since = self._clock()
            return StatusSnapshot(self._effective(), self._since, self._activity, self._pending)

    def apply_screen(self, verdict: str | None, visible_blocker: bool) -> bool:
        """One screen observation (new detector verdict or None); True if the payload changed."""
        with self._lock:
            before = self._fingerprint()
            if not self._hooked:
                if verdict is not None and verdict != self._live:
                    self._set_live(verdict, unread_on_idle=True)
            elif visible_blocker and not self._screen_blocker and self._live != STATUS_BLOCKED:
                self._live = STATUS_BLOCKED
            elif not visible_blocker and self._screen_blocker and self._live == STATUS_BLOCKED:
                self._live = STATUS_WORKING
                if self._activity is None:
                    self._activity = AgentActivity(None, None, self._clock())
                self._clear_pending()
            self._screen_blocker = visible_blocker
            return self._commit(before)

    def apply_hook(self, body: dict) -> HookOutcome:
        """Maps one Claude Code hook report onto the status; unknown events change nothing."""
        name = body.get("hook_event_name") if isinstance(body.get("hook_event_name"), str) else ""
        tool = body.get("tool_name") if isinstance(body.get("tool_name"), str) else None
        with self._lock:
            before = self._fingerprint()
            now = self._clock()
            if name == "UserPromptSubmit":
                self._clear_pending()
                self._activity = AgentActivity(None, None, now)
                self._set_live(STATUS_WORKING)
            elif name == "PreToolUse":
                self._clear_pending()
                started = self._activity.turn_started_at if self._activity else now
                self._activity = AgentActivity(tool, hook_target(body.get("tool_input")), started)
                self._set_live(STATUS_WORKING)
            elif name == "PostToolUse":
                self._clear_pending()
                if self._activity is None:
                    self._activity = AgentActivity(None, None, now)
                self._set_live(STATUS_WORKING)
            elif name == "Notification":
                kind = body.get("notification_type")
                kind = kind if isinstance(kind, str) else ""
                if kind == "permission_prompt" or kind.startswith("elicitation"):
                    self._set_live(STATUS_BLOCKED)
            elif name == "PermissionRequest":
                self._clear_pending()
                target = hook_target(body.get("tool_input"))
                label = tool or "tool"
                self._pending = PendingPermission(
                    f"p_{secrets.token_hex(3)}", label,
                    label if target is None else f"{label}({target})", now,
                )
                self._waiter = Future()
                self._set_live(STATUS_BLOCKED)
            elif name == "Stop":
                self._clear_pending()
                self._set_live(STATUS_IDLE)
                self._unread = True
            else:
                return HookOutcome(False)
            self._hooked = True
            changed = self._commit(before)
            if name == "PermissionRequest" and self._pending is not None:
                return HookOutcome(changed, self._pending.request_id, self._waiter)
            return HookOutcome(changed)

    def mark_seen(self) -> bool:
        """Done becomes idle once the user looked at the agent; True if that changed anything."""
        with self._lock:
            before = self._fingerprint()
            self._unread = False
            return self._commit(before)

    def decide(self, request_id: str, decision: str) -> bool:
        """Hands the canvas's decision to the waiting hook; False if no such request is pending."""
        with self._lock:
            if self._pending is None or self._pending.request_id != request_id:
                return False
            if self._waiter is not None and not self._waiter.done():
                self._waiter.set_result(decision)
            self._waiter = None
            self._pending = None
            return True

    def expire(self, request_id: str) -> bool:
        """Drops a request nobody answered in time; True when it was still pending."""
        with self._lock:
            if self._pending is None or self._pending.request_id != request_id:
                return False
            self._clear_pending()
            return True

    def exit(self) -> None:
        """The process ended: any waiting hook gets no decision and the status clock restarts."""
        with self._lock:
            self._clear_pending()
            self._activity = None
            self._since = self._clock()

    def _effective(self) -> str:
        return STATUS_DONE if self._live == STATUS_IDLE and self._unread else self._live

    def _set_live(self, status: str, unread_on_idle: bool = False) -> None:
        if unread_on_idle and self._live == STATUS_WORKING and status == STATUS_IDLE:
            self._unread = True
        if status == STATUS_WORKING:
            self._unread = False
            if not self._hooked and self._activity is None:
                self._activity = AgentActivity(None, None, self._clock())
        if status == STATUS_IDLE:
            self._activity = None
        self._live = status

    def _clear_pending(self) -> None:
        if self._waiter is not None and not self._waiter.done():
            self._waiter.set_result(None)
        self._waiter = None
        self._pending = None

    def _fingerprint(self) -> tuple:
        return self._effective(), self._activity, self._pending

    def _commit(self, before: tuple) -> bool:
        if before[0] != self._effective() or self._since is None:
            self._since = self._clock()
        return before != self._fingerprint()
