"""Long-lived agent PTYs owned by the bridge, with scrollback so a window can reattach to one.

🔴 The process is spawned here, in the bridge, never by the renderer — that is the only way it
inherits the PATH `desktop/src/shellPath.ts` repaired at startup, without which a Finder-launched
app cannot find `/opt/homebrew/bin/claude` and every agent dies instantly.

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
import shutil
import time
from pathlib import Path
from typing import Protocol, runtime_checkable

from codechroma.bridge.agents.status import StatusDetector, load_manifest_for
from codechroma.config import settings
from codechroma.errors import codechromaError
from codechroma.terminal.pty_session import PtySession, default_cols, default_rows
from codechroma.terminal.screen_tap import ScreenTap

logger = logging.getLogger("uvicorn.error")

STATUS_RUNNING = "running"
STATUS_STOPPED = "stopped"
STATUS_EXITED = "exited"


def context_inject_attempts() -> int:
    return settings.agents_routes.context_inject_attempts


def context_inject_interval_seconds() -> float:
    return settings.agents_routes.context_inject_interval_seconds


def agent_run_env(agent_id: str, extra: dict[str, str] | None = None) -> dict[str, str]:
    """The env a live agent's PTY should run under.

    The workspace id is injected so diagram skills address the agent's own `/repos/<id>/...`
    and write into its own `.codechroma/` instead of falling back to `default` in the main checkout
    — without it a change the agent canvas never reads lands in main. Provider env overrides from a
    resolved launch (`extra`, 061) are merged underneath, so the workspace id wins on any collision.
    """
    return {**(extra or {}), "codechroma_WORKSPACE_ID": agent_id}


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

    def inject_when_idle(self, text: str) -> asyncio.Task: ...


class AgentSession(AgentSessionPort):
    """One PTY-attached agent process plus its scrollback and the consumers watching it."""

    def __init__(
        self,
        agent_id: str,
        argv: list[str],
        cwd: str,
        kind: str = "claude",
        env: dict[str, str] | None = None,
    ) -> None:
        self.agent_id = agent_id
        self.argv = list(argv)
        self.exit_code: int | None = None
        self._consumers: set[asyncio.Queue] = set()
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
    def status(self) -> str:
        """`exited` once the process is gone; while it runs, what the detector last settled on."""
        if self.exit_code is not None:
            return STATUS_EXITED
        return self._detector.status

    def poll_status(self) -> str | None:
        """The detector's verdict, or None when nothing changed — the LED's one source of truth."""
        if self.exit_code is not None:
            return None
        return self._detector.observe(
            self._tap.tail(self._detector.rules.tail_lines),
            title=self._tap.title,
            progress=self._tap.progress,
            process=self._tap.foreground_process(self._pty.master_fd, time.monotonic()),
        )

    def attach(self) -> asyncio.Queue:
        """A queue seeded with a screen redraw, so a reattach can never start mid-sequence."""
        queue: asyncio.Queue = asyncio.Queue()
        queue.put_nowait(self._tap.render())
        self._consumers.add(queue)
        return queue

    def resync(self, queue: asyncio.Queue) -> None:
        """Redraws one consumer, so a client that just reported its own size sees that geometry."""
        if queue in self._consumers:
            queue.put_nowait(self._tap.render())

    def detach(self, queue: asyncio.Queue) -> None:
        """Drops one consumer; the process keeps running with nobody watching."""
        self._consumers.discard(queue)

    def write(self, data: str) -> None:
        self._pty.write(data)

    def write_bytes(self, data: bytes) -> None:
        self._pty.write_bytes(data)

    def inject_when_idle(self, text: str) -> asyncio.Task:
        """Types `text` once a fresh agent's TUI reaches its idle prompt (acknowledge-only only).

        Spawned from `post_agent_start` on a *fresh* start (never a resume, never autostart): the
        context is delivered as a normal user message it reads on first boot. Polls the same
        `StatusDetector` / `detect/claude.toml` `[idle]` rule the LED uses until it classifies the
        rendered `ScreenTap` as idle, then writes `text + "\\r"`. Gives up quietly if the agent
        never idles in time or the process dies — typing into a working/blocked agent would corrupt
        whatever it is already doing. Returns the background task; it never raises.
        """
        async def run() -> None:
            if self.exit_code is not None:
                return
            attempts = context_inject_attempts()
            interval = context_inject_interval_seconds()
            for _attempt in range(attempts):
                # Not unreachable: exit_code can flip between iterations across the await below.
                if self.exit_code is not None:
                    return  # type: ignore[unreachable]
                tail = self._tap.tail(self._detector.rules.tail_lines)
                verdict = self._detector.classify(tail, self._tap.title, self._tap.progress, None)
                if verdict == "idle":
                    self.write(text + "\r")
                    return
                await asyncio.sleep(interval)
            logger.info(
                "agents: gave up injecting context into %s (never went idle)", self.agent_id
            )

        task = asyncio.create_task(run())
        return task

    def resize(self, rows: int, cols: int) -> None:
        self._pty.resize(rows, cols)
        self._tap.resize(rows, cols)

    def close(self) -> None:
        """Kills the process; needs the running loop, so call it from the bridge's event loop."""
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
        for queue in list(self._consumers):
            queue.put_nowait(None)


class AgentSessionRegistry:
    """Every live agent PTY, keyed by agent id — the one place their processes are tracked."""

    def __init__(self) -> None:
        self._sessions: dict[str, AgentSession] = {}

    def get(self, agent_id: str) -> AgentSession | None:
        return self._sessions.get(agent_id)

    def is_running(self, agent_id: str) -> bool:
        """Whether the process is alive — not what the LED says, which is a screen reading."""
        session = self._sessions.get(agent_id)
        return session is not None and session.is_alive

    def poll_statuses(self) -> list[tuple[str, str]]:
        """Every agent whose status just changed, as (id, status) — the poller's whole output."""
        changed = []
        for agent_id, session in list(self._sessions.items()):
            status = session.poll_status()
            if status is not None:
                changed.append((agent_id, status))
        return changed

    def start(
        self,
        agent_id: str,
        argv: list[str],
        cwd: Path,
        kind: str = "claude",
        env: dict[str, str] | None = None,
    ) -> AgentSession:
        """Spawns the agent, or returns the session already running for it."""
        existing = self._sessions.get(agent_id)
        if existing is not None and existing.is_alive:
            return existing
        if not argv:
            raise AgentStartError("no command configured for this agent kind")
        if shutil.which(argv[0]) is None:
            raise AgentStartError(f"{argv[0]} CLI not found on PATH")
        if not cwd.is_dir():
            raise AgentStartError(f"the agent's worktree is missing: {cwd}")
        try:
            session = AgentSession(agent_id, argv, str(cwd), kind=kind, env=env)
        except OSError as exc:
            raise AgentStartError(f"could not start {argv[0]}: {exc}") from exc
        self._sessions[agent_id] = session
        return session

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
