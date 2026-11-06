"""Long-lived agent PTYs owned by the bridge, with scrollback so a window can reattach to one.

Agent lookup and launch use llm.runtime_env, including the user's login-shell
exports when the macOS GUI environment is incomplete.

The session outlives any single WebSocket: minimizing a window, or reloading the page, must not kill
the agent. So output is fanned out to zero or more attached consumers, and a reattaching consumer is
sent a redraw of the current screen rather than a replay of raw bytes.

🔴 The raw stream cannot be replayed. Any bounded buffer is truncated at an arbitrary byte offset,
so the replay can begin mid-CSI, and the sequences that *establish* screen state (alt-screen enter,
scroll region, bracketed paste, the opening SGR) are the oldest bytes and therefore the first
evicted — the new xterm ends up in default mode while the agent believes it is on the alt screen.
`ScreenTap` already keeps a rendered `pyte` screen for the status detector; redrawing that is
deterministic and can never be malformed. The trade-off is deliberate: a reattach shows the current
screen, not history above the fold.

🔴 This registry is entirely separate from skill_agent's, whose `cancel_all()` kills the C1 runners.
If the two ever touched, regenerating a C1 diagram would kill the user's sessions.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Protocol, runtime_checkable

from codechroma.bridge.agents.agent_hook import is_clear
from codechroma.bridge.agents.history_clear import (
    CLEAR_SCROLLBACK,
    REPAINT_DELAY_SECONDS,
    ClearWatch,
    TypedClearDetector,
)
from codechroma.bridge.agents.live_status import (
    STATUS_ERROR,
    STATUS_IDLE,
    STATUS_STOPPED,
    AgentError,
    AgentStatusState,
    HookOutcome,
    StatusSnapshot,
)
from codechroma.bridge.agents.session_ownership import FILE_ENV, INITIAL_ID_ENV
from codechroma.bridge.agents.status import Classification, StatusDetector, load_manifest_for
from codechroma.config import settings
from codechroma.errors import codechromaError
from codechroma.io import utc_now
from codechroma.llm.runtime_env import CliLookupError, launch_failed, resolve_runtime_cli
from codechroma.questions.launch import identity_env
from codechroma.terminal.pty_session import PtySession, default_cols, default_rows
from codechroma.terminal.screen_tap import ScreenTap

logger = logging.getLogger("uvicorn.error")

def context_inject_attempts() -> int:
    return settings.agents_routes.context_inject_attempts


def context_inject_interval_seconds() -> float:
    return settings.agents_routes.context_inject_interval_seconds


# Text to type, or a callable that builds it at idle time (None: nothing to type any more).
InjectText = str | Callable[[], Awaitable[str | None]]


def context_inject_submit_delay_seconds() -> float:
    return settings.agents_routes.context_inject_submit_delay_seconds


def agent_run_env(agent_id: str, extra: dict[str, str] | None = None) -> dict[str, str]:
    """The env a live agent's PTY should run under.

    The workspace id is injected so diagram skills address the agent's own `/repos/<id>/...`
    and write into its own `.codechroma/` instead of falling back to `default` in the main checkout
    — without it a change the agent canvas never reads lands in main. Provider env overrides from a
    resolved launch (`extra`, 061) are merged underneath, so the workspace id wins on any collision.
    """
    return {**(extra or {}), **identity_env(agent_id)}


class AgentStartError(codechromaError):
    """The agent process could not be started; the message is shown to the user verbatim."""


@runtime_checkable
class AgentSessionPort(Protocol):
    """A long-lived PTY session a terminal window can attach to and follow live."""

    def attach(self) -> asyncio.Queue: ...

    def resync(self, queue: asyncio.Queue) -> None: ...

    def detach(self, queue: asyncio.Queue) -> None: ...

    def write(self, data: str) -> None: ...

    def write_bytes(self, data: bytes) -> None: ...

    def resize(self, rows: int, cols: int) -> None: ...

    def inject_when_idle(
        self, text: InjectText, attempts: int | None = None
    ) -> asyncio.Task[bool]: ...


class AgentSession(AgentSessionPort):
    """One PTY-attached agent process plus its scrollback and the consumers watching it."""

    def __init__(
        self,
        agent_id: str,
        argv: list[str],
        cwd: str,
        kind: str = "claude",
        env: dict[str, str] | None = None,
        on_exit: Callable[[AgentSession], None] | None = None,
        clear: ClearWatch | None = None,
        on_clear: Callable[[AgentSession], None] | None = None,
    ) -> None:
        self.agent_id = agent_id
        self._clear = clear
        self._cleared = on_clear
        self._typed_clear = (
            TypedClearDetector(clear.typed_commands) if clear and clear.typed_commands else None
        )
        self._typed_lock = threading.Lock()
        self.argv = list(argv)
        self.session_tracking_file = (env or {}).get(FILE_ENV)
        self.initial_session_id = (env or {}).get(INITIAL_ID_ENV)
        self.exit_code: int | None = None
        self._exit_error: AgentError | None = None
        self._screen_key: tuple | None = None
        self._screen_verdict = Classification()
        self._closing = False
        self._exited = on_exit
        self._state = AgentStatusState()
        # The poll thread and hook requests both drive the detector, which is not thread-safe.
        self._detector_lock = threading.Lock()
        self._consumers: set[asyncio.Queue] = set()
        self._inject_lock = asyncio.Lock()
        # Seeded with the PTY's own geometry, so the tap renders the screen the agent actually drew.
        self._tap = ScreenTap(rows=default_rows(), cols=default_cols())
        self._detector = StatusDetector(load_manifest_for(kind))
        self._pty = PtySession(
            argv, on_output=self._on_output, on_exit=self._on_exit, cwd=cwd, env=env
        )

    @property
    def pid(self) -> int | None:
        return self._pty.pid

    @property
    def is_alive(self) -> bool:
        return self.exit_code is None

    @property
    def detects_idle(self) -> bool:
        """Whether the detector can ever report idle, so an inject_when_idle can ever type."""
        return self._detector.rules.classifies

    @property
    def status(self) -> str:
        """Live: idle, working, blocked or done; gone: error after a non-zero exit, else stopped."""
        return self.snapshot().status

    def snapshot(self) -> StatusSnapshot:
        """The live status fields; an exited session reports stopped, or error with its cause."""
        live = self._state.snapshot()
        if self.exit_code is None:
            return live
        if self._exit_error is None:
            return StatusSnapshot(STATUS_STOPPED, live.since, None, None)
        return StatusSnapshot(STATUS_ERROR, live.since, None, None, self._exit_error)

    def poll_status(self) -> bool:
        """Samples the screen once; True when the status payload changed."""
        if self.exit_code is not None:
            return False
        tap = self._tap
        process = tap.foreground_process(self._pty.master_fd, time.monotonic())
        key = (tap.generation, tap.title, tap.progress, process)
        with self._detector_lock:
            # The rules only run when the screen, title, progress or process changed.
            if key != self._screen_key:
                tail = tap.tail(self._detector.rules.tail_lines)
                self._screen_verdict = self._detector.evaluate(tail, key[1], key[2], process)
                self._screen_key = key
            verdict = self._detector.settle(self._screen_verdict)
            last = self._detector.last_classification
            changed = self._state.apply_screen(verdict, last.visible_blocker, last.visible_idle)
            self._sync()
            return changed

    def apply_hook(self, body: dict) -> HookOutcome:
        """Applies one Claude Code hook report and keeps the detector in step with it."""
        if self.exit_code is not None:
            return HookOutcome(False)
        if is_clear(body):
            self.clear_history()
        with self._detector_lock:
            outcome = self._state.apply_hook(body)
            self._sync()
            return outcome

    def _sync(self) -> None:
        """Once hooks report, the detector holds whatever status they set."""
        if self._state.hooked:
            self._detector.force(self._state.live)

    def mark_seen(self) -> bool:
        """Done becomes idle; True when that changed the status."""
        return self._state.mark_seen()

    def decide(self, request_id: str, decision: str) -> bool:
        """Answers a pending PermissionRequest; False when no such request waits."""
        with self._detector_lock:
            decided = self._state.decide(request_id, decision)
            self._sync()
            return decided

    def expire_permission(self, request_id: str) -> bool:
        """Drops an unanswered PermissionRequest; True when it was still pending."""
        return self._state.expire(request_id)

    def dismiss_error(self) -> bool:
        """Clears the exit error so the agent reads as stopped; True when there was one."""
        had = self._exit_error is not None
        self._exit_error = None
        return had

    def attach(self) -> asyncio.Queue:
        """A queue seeded with a screen redraw, so a reattach can never start mid-sequence."""
        queue: asyncio.Queue = asyncio.Queue()
        queue.put_nowait(self._tap.render())
        self._consumers.add(queue)
        self._pty.client_attached = True
        return queue

    def resync(self, queue: asyncio.Queue) -> None:
        """Redraws one consumer, so a client that just reported its own size sees that geometry."""
        if queue in self._consumers:
            queue.put_nowait(self._tap.render())

    def detach(self, queue: asyncio.Queue) -> None:
        """Drops one consumer; the process keeps running with nobody watching."""
        self._consumers.discard(queue)
        self._pty.client_attached = bool(self._consumers)

    def write(self, data: str) -> None:
        """Types into the agent; a submitted clear command of a CLI without a clear hook clears."""
        self._pty.write(data)
        if self._typed_clear is None:
            return
        with self._typed_lock:
            cleared = self._typed_clear.feed(data)
        if cleared:
            self.clear_history()

    def clear_history(self) -> None:
        """The user cleared the chat: windows drop their scrollback, then the CLI repaints."""
        if self.exit_code is not None:
            return
        self._on_output(CLEAR_SCROLLBACK)
        repaint = self._clear.repaint if self._clear is not None else None
        if repaint:
            timer = threading.Timer(REPAINT_DELAY_SECONDS, self._repaint, args=(repaint,))
            timer.daemon = True
            timer.start()
        if self._cleared is not None:
            try:
                self._cleared(self)
            except Exception:
                logger.exception("agents: clear callback failed for %s", self.agent_id)

    def _repaint(self, keys: str) -> None:
        if self.exit_code is None:
            self._pty.write(keys)

    def write_bytes(self, data: bytes) -> None:
        self._pty.write_bytes(data)

    def inject_when_idle(self, text: InjectText, attempts: int | None = None) -> asyncio.Task[bool]:
        """Types `text` once a fresh agent's TUI reaches its idle prompt (acknowledge-only only).

        Spawned from `post_agent_start` on a *fresh* start (never a resume, never autostart): the
        context is delivered as a normal user message it reads on first boot. Polls the same
        `StatusDetector` / `detect/claude.toml` `[idle]` rule the LED uses until it classifies the
        rendered `ScreenTap` as idle, then types `text` (built at that moment when it is a
        callable), then Enter. Gives up quietly if the agent never idles in time or the process
        dies (`attempts` overrides the context default) — typing into a working/blocked agent
        would corrupt whatever it is already doing. Returns the background task, which resolves
        True once the text was typed; it never raises.
        """
        async def run() -> bool:
            async with self._inject_lock:
                return await self._inject_once(text, attempts)


        task = asyncio.create_task(run())
        return task

    async def _inject_once(self, text: InjectText, attempts: int | None) -> bool:
        """One queued injection: waits for idle, types it, lets the screen settle; True if typed."""
        if self.exit_code is not None:
            return False
        tries = attempts if attempts is not None else context_inject_attempts()
        interval = context_inject_interval_seconds()
        for _attempt in range(tries):
            # Not unreachable: exit_code can flip between iterations across the await below.
            if self.exit_code is not None:
                return False  # type: ignore[unreachable]
            tail = self._tap.tail(self._detector.rules.tail_lines)
            verdict = self._detector.classify(tail, self._tap.title, self._tap.progress, None)
            if verdict == STATUS_IDLE:
                body = await self._inject_body(text)
                if body is None:
                    return False
                # Enter goes alone: text + "\r" in one write reads as a paste and never submits.
                self.write(body)
                await asyncio.sleep(context_inject_submit_delay_seconds())
                self.write("\r")
                await asyncio.sleep(interval)
                return True
            await asyncio.sleep(interval)
        logger.info("agents: gave up injecting context into %s (never went idle)", self.agent_id)
        return False

    async def _inject_body(self, text: InjectText) -> str | None:
        """The text to type now; a callable that fails counts as nothing to type."""
        if isinstance(text, str):
            return text
        try:
            return await text()
        except Exception:
            logger.exception("agents: could not build the text to type into %s", self.agent_id)
            return None

    def resize(self, rows: int, cols: int) -> None:
        self._pty.resize(rows, cols)
        self._tap.resize(rows, cols)

    def close(self) -> None:
        """Kills the process from the event loop; a deliberate kill is no error."""
        self._closing = True
        self._pty.close()

    def terminate_process(self) -> None:
        """Loop-free kill for atexit, where `close()`'s remove_reader() has no loop to talk to."""
        if self.exit_code is None:
            self._pty.terminate_process()

    def _on_output(self, chunk: str) -> None:
        # The detector reads the rendered screen, and so does a reattach; same chunks as the socket.
        self._tap.feed(chunk)
        for queue in list(self._consumers):
            queue.put_nowait(chunk)

    def _on_exit(self) -> None:
        self.exit_code = self._pty.returncode if self._pty.returncode is not None else 0
        if self.exit_code != 0 and not self._closing:
            name = Path(self.argv[0]).stem if self.argv else "agent"
            self._exit_error = AgentError(f"{name} exited with code {self.exit_code}", utc_now())
        self._state.exit()
        for queue in list(self._consumers):
            queue.put_nowait(None)
        if self._exited is not None:
            try:
                self._exited(self)
            except Exception:
                logger.exception("agents: exit callback failed for %s", self.agent_id)


class AgentSessionRegistry:
    """Every live agent PTY, keyed by agent id — the one place their processes are tracked."""

    def __init__(self) -> None:
        self._sessions: dict[str, AgentSession] = {}
        # Called with the agent id when a registered session exits on its own (not after stop()).
        self.on_exit: Callable[[str], None] | None = None
        # Called with the agent id when the user cleared a registered session's conversation.
        self.on_clear: Callable[[str], None] | None = None

    def get(self, agent_id: str) -> AgentSession | None:
        return self._sessions.get(agent_id)

    def is_running(self, agent_id: str) -> bool:
        """Whether the process is alive — not what the LED says, which is a screen reading."""
        session = self._sessions.get(agent_id)
        return session is not None and session.is_alive

    def poll_statuses(self) -> list[str]:
        """Every agent whose status payload just changed — the poller's whole output."""
        sessions = list(self._sessions.items())
        return [agent_id for agent_id, session in sessions if session.poll_status()]

    def start(
        self,
        agent_id: str,
        argv: list[str],
        cwd: Path,
        kind: str = "claude",
        env: dict[str, str] | None = None,
        clear: ClearWatch | None = None,
    ) -> AgentSession:
        """Spawns the agent, or returns the session already running for it."""
        existing = self._sessions.get(agent_id)
        if existing is not None and existing.is_alive:
            return existing
        if not argv:
            raise AgentStartError("no command configured for this agent kind")
        try:
            runtime = resolve_runtime_cli(argv[0], env)
        except CliLookupError as exc:
            raise AgentStartError(str(exc)) from exc
        argv = [runtime.executable, *argv[1:]]
        env = dict(runtime.env)
        if not cwd.is_dir():
            raise AgentStartError(f"the agent's worktree is missing: {cwd}")
        try:
            session = AgentSession(
                agent_id, argv, str(cwd), kind=kind, env=env, on_exit=self._session_exited,
                clear=clear, on_clear=self._session_cleared,
            )
        except Exception as exc:
            launch_failed(exc)
            raise AgentStartError(runtime.launch_error(exc)) from exc
        self._sessions[agent_id] = session
        return session

    def _session_exited(self, session: AgentSession) -> None:
        if self.on_exit is not None and self._sessions.get(session.agent_id) is session:
            self.on_exit(session.agent_id)

    def _session_cleared(self, session: AgentSession) -> None:
        if self.on_clear is not None and self._sessions.get(session.agent_id) is session:
            self.on_clear(session.agent_id)

    def stop(self, agent_id: str) -> bool:
        """Kills one agent's PTY, keeping its worktree and branch; False if it wasn't running."""
        session = self._sessions.pop(agent_id, None)
        if session is None:
            return False
        session.close()
        return True

    def stop_all(self) -> None:
        """Kills every agent PTY from the event loop — the lifespan's shutdown path."""
        for agent_id in list(self._sessions):
            self.stop(agent_id)

    def terminate_all(self) -> None:
        """Loop-free kill for atexit, so closing the app leaves no orphan writing to files."""
        for session in list(self._sessions.values()):
            session.terminate_process()
