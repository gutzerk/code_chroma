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
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Protocol, runtime_checkable

from codechroma.bridge.agents.agent_hook import is_clear
from codechroma.bridge.agents.history_clear import (
    CLEAR_SCROLLBACK,
    REPAINT_DELAY_SECONDS,
    RESET_SCREEN,
    ClearWatch,
    TypedLine,
)
from codechroma.bridge.agents.live_status import (
    STATUS_DONE,
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
from codechroma.llm.runtime_env import (
    CliLookupError,
    RuntimeCli,
    launch_failed,
    resolve_runtime_cli,
)
from codechroma.questions.launch import identity_env
from codechroma.terminal.pty_session import PtySession, default_cols, default_rows
from codechroma.terminal.screen_tap import ScreenTap

logger = logging.getLogger("uvicorn.error")

# Columns a window must grow past the narrowest printed width before a resume reprints it.
WIDEN_MIN_GAIN_COLS = 8
# Quiet time after the last resize, so dragging a window edge restarts at most once.
WIDEN_SETTLE = timedelta(seconds=1.5)
# Quiet time after the last keystroke, so a restart never lands mid-typing.
WIDEN_TYPING_QUIET = timedelta(seconds=3)
# Focus (ESC [ I / O) and mouse (ESC [ M, ESC [ <) reports the terminal sends on its own.
_NEVER = datetime.min.replace(tzinfo=UTC)

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
        # The prompt line: the draft a restart would lose, and a typed clear of a hookless CLI.
        self._typed = TypedLine(clear.typed_commands if clear else ())
        self._typed_lock = threading.Lock()
        # A clear asked for mid escape sequence; emitted after the next chunk ending in ground.
        self._clear_pending = False
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
        self._prompt_context: str | None = None
        self._prompt_context_lock = threading.Lock()
        self._consumers: set[asyncio.Queue] = set()
        self._inject_lock = asyncio.Lock()
        # Seeded with the PTY's own geometry, so the tap renders the screen the agent actually drew.
        self._tap = ScreenTap(rows=default_rows(), cols=default_cols())
        self._detector = StatusDetector(load_manifest_for(kind))
        # Which PTY of this session is current; callbacks of a replaced one are ignored.
        self._spawn = 0
        self._rows = default_rows()
        self._cols = default_cols()
        self._narrowest_printed: int | None = None
        self._resized_at = _NEVER
        self._typed_at = _NEVER
        self._widen_not_before = _NEVER
        self._injecting = 0
        self._pty = self._spawn_pty(argv, cwd, env)

    def _spawn_pty(self, argv: list[str], cwd: str, env: dict[str, str] | None) -> PtySession:
        spawn = self._spawn
        return PtySession(
            argv, on_output=lambda chunk: self._on_output(chunk, spawn),
            on_exit=lambda: self._on_exit(spawn), cwd=cwd, env=env,
            rows=self._rows, cols=self._cols,
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

    def hold_prompt_context(self, context: str) -> None:
        """Holds hidden context for the next prompt the user submits; never typed into the PTY."""
        with self._prompt_context_lock:
            self._prompt_context = context

    def take_prompt_context(self) -> str | None:
        """The held prompt context, handed out once."""
        with self._prompt_context_lock:
            context, self._prompt_context = self._prompt_context, None
            return context

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

    @property
    def attached_windows(self) -> int:
        """How many windows are attached right now; 0 means nobody can see this agent."""
        return len(self._consumers)

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
        self._type(data)

    def _type(self, data: str, injected: bool = False) -> None:
        """Types data; bridge-composed (injected) text never reads as a clear command."""
        cleared = self._note_typing(data, injected)
        self._pty.write(data)
        if cleared:
            self.clear_history()

    def clear_history(self) -> None:
        """The user cleared the chat: windows drop their scrollback, then the CLI repaints."""
        if self.exit_code is not None:
            return
        self._clear_pending = True
        self._flush_pending_clear()
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

    def _note_typing(self, data: str, injected: bool = False) -> bool:
        """Feeds the prompt line; True on a user-submitted clear; a lone Escape is not typing."""
        if data in ("", "\x1b"):
            return False
        self._typed_at = utc_now()
        with self._typed_lock:
            return self._typed.feed(data, injected)

    @property
    def has_draft(self) -> bool:
        """Whether the prompt holds a draft a restart would lose."""
        return self._typed.has_draft

    def _input_busy(self, now: datetime) -> bool:
        """A restart now would lose input: an injection in flight, a draft, or a recent key."""
        return bool(self._injecting) or self.has_draft or now - self._typed_at < WIDEN_TYPING_QUIET

    @property
    def resumes_on_widen(self) -> bool:
        """A tracked claude launch that is not a bare skill window can be resumed in place."""
        return self.session_tracking_file is not None and "--system-prompt" not in self.argv

    def widen_due(self, now: datetime) -> bool:
        """True once the window settled wider than the narrowest printed width, idle and untyped."""
        if not self.resumes_on_widen or self._input_busy(now) or self.exit_code is not None:
            return False
        live = self._state.snapshot()
        if live.status not in (STATUS_IDLE, STATUS_DONE) or live.pending is not None:
            return False
        narrowest = self._narrowest_printed
        return (
            narrowest is not None
            and self._cols >= narrowest + WIDEN_MIN_GAIN_COLS
            and now - self._resized_at >= WIDEN_SETTLE and now >= self._widen_not_before
        )

    def settle_width(self) -> None:
        """Takes the current width as printed, so a widen that cannot resume is not retried."""
        self._narrowest_printed = self._cols

    def postpone_widen(self, until: datetime) -> None:
        """Holds a due widen until `until`, for a check that may pass later (an open question)."""
        self._widen_not_before = until

    def respawn(self, argv: list[str], cwd: str, env: dict[str, str] | None) -> bool:
        """Runs `argv` on a new PTY at the current size in place of the old; False keeps the old."""
        # Re-checked here, so an injection's text and Enter never straddle the swap.
        if self.exit_code is not None or self._closing or self._input_busy(utc_now()):
            return False
        old = self._pty
        self._spawn += 1
        try:
            self._pty = self._spawn_pty(argv, cwd, env)
        except Exception as exc:
            self._spawn -= 1
            logger.warning("agents: could not restart %s at the new width: %s", self.agent_id, exc)
            return False
        self.argv = list(argv)
        self.session_tracking_file = (env or {}).get(FILE_ENV)
        self.initial_session_id = (env or {}).get(INITIAL_ID_ENV)
        self._narrowest_printed = None
        self._pty.client_attached = bool(self._consumers)
        # Single-threaded loop: the clear goes out before any byte of the new process.
        self._emit(RESET_SCREEN)
        old.close()
        return True

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
            try:
                async with self._inject_lock:
                    return await self._inject_once(text, attempts)
            finally:
                self._injecting -= 1

        self._injecting += 1
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
                self._type(body, injected=True)
                await asyncio.sleep(context_inject_submit_delay_seconds())
                self._type("\r", injected=True)
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
        self._rows = rows
        self._cols = cols
        self._resized_at = utc_now()

    def close(self) -> None:
        """Kills the process from the event loop; a deliberate kill is no error."""
        self._closing = True
        self._pty.close()

    def terminate_process(self) -> None:
        """Loop-free kill for atexit, where `close()`'s remove_reader() has no loop to talk to."""
        if self.exit_code is None:
            self._pty.terminate_process()

    def _on_output(self, chunk: str, spawn: int) -> None:
        if spawn != self._spawn:
            return
        self._narrowest_printed = min(self._narrowest_printed or self._cols, self._cols)
        self._emit(chunk)
        self._flush_pending_clear()

    def _flush_pending_clear(self) -> None:
        """Sends a pending clear once the tap is in ground; mid-sequence its ESC prints a tail."""
        if self._clear_pending and self._tap.in_ground:
            self._clear_pending = False
            self._emit(CLEAR_SCROLLBACK)

    def _emit(self, chunk: str) -> None:
        """Feeds the tap and every window; the detector and a reattach read the same chunks."""
        self._tap.feed(chunk)
        for queue in list(self._consumers):
            queue.put_nowait(chunk)

    def _on_exit(self, spawn: int = 0) -> None:
        if spawn != self._spawn:
            return
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


def _resolve_launch(argv: list[str], cwd: Path, env: dict[str, str] | None) -> RuntimeCli:
    """The agent's CLI resolved for `env`; raises AgentStartError when it cannot start in `cwd`."""
    if not argv:
        raise AgentStartError("no command configured for this agent kind")
    try:
        runtime = resolve_runtime_cli(argv[0], env)
    except CliLookupError as exc:
        raise AgentStartError(str(exc)) from exc
    if not cwd.is_dir():
        raise AgentStartError(f"the agent's worktree is missing: {cwd}")
    return runtime


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

    def attached_windows(self, agent_id: str) -> int:
        """Windows attached to the agent's session; 0 without a session (not a bridge agent)."""
        session = self._sessions.get(agent_id)
        return session.attached_windows if session is not None else 0

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
        runtime = _resolve_launch(argv, cwd, env)
        argv = [runtime.executable, *argv[1:]]
        env = dict(runtime.env)
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

    def all(self) -> list[AgentSession]:
        """Every registered session, live or exited."""
        return list(self._sessions.values())

    def respawn(
        self, session: AgentSession, argv: list[str], cwd: Path, env: dict[str, str] | None = None
    ) -> bool:
        """Restarts `session` in place while it is the live one registered; False keeps the old."""
        # A session stopped (and maybe restarted) during the sweep is not this one any more.
        if self._sessions.get(session.agent_id) is not session or not session.is_alive:
            return False
        try:
            runtime = _resolve_launch(argv, cwd, env)
        except AgentStartError:
            return False
        return session.respawn([runtime.executable, *argv[1:]], str(cwd), dict(runtime.env))

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
