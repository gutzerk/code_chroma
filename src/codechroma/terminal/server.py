"""FastAPI app exposing a WebSocket terminal bridge to a local PTY-attached shell process."""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import os
from collections.abc import Callable
from pathlib import Path

from fastapi import APIRouter, FastAPI, WebSocket, WebSocketDisconnect

from codechroma.bridge.agents.sessions import AgentSessionPort
from codechroma.terminal.agents import ALLOWED_AGENTS
from codechroma.terminal.pty_session import PtySession

router = APIRouter()

_UNKNOWN_AGENT_CLOSE_CODE = 4404
_NO_SESSION_CLOSE_CODE = 4409

# Frames carry a one-character tag so PTY output that happens to look like JSON is never eaten.
_OUTPUT_TAG = "o"
_ERROR_TAG = "e"
PROJECT_ROOT = Path(__file__).resolve().parents[3]

MAIN_WORKSPACE = "main"


def _services(websocket: WebSocket) -> object | None:
    """The per-app services when the terminal is mounted on the graph bridge, else None."""
    # Mounted apps have `app.state.services`; the standalone terminal app runs without one.
    return getattr(websocket.app.state, "services", None)


def _resolve_cwd(websocket: WebSocket, workspace: str = "") -> str:
    """The named workspace's root when one is served, else the analyzed repo, else the project."""
    if workspace:
        services = _services(websocket)
        cwd_for = getattr(services, "workspace_cwd", None) if services is not None else None
        resolved = cwd_for(workspace) if cwd_for is not None else None
        if resolved:
            return resolved
    repo_path = os.environ.get("codechroma_BRIDGE_REPO_PATH")
    return str(PROJECT_ROOT / repo_path) if repo_path else str(PROJECT_ROOT)


@router.websocket("/ws/terminal")
async def terminal_socket(websocket: WebSocket) -> None:
    await websocket.accept()
    agent = websocket.query_params.get("agent") or ""
    workspace = websocket.query_params.get("workspace") or ""
    argv = ALLOWED_AGENTS.get(agent)
    if argv is None:
        await _fail(websocket, f"unknown agent: {agent}", _UNKNOWN_AGENT_CLOSE_CODE)
        return

    services = _services(websocket)
    session = getattr(services, "agent_sessions", None) if services is not None else None
    session = session.get(workspace) if session is not None and workspace else None
    if session is not None:
        await _bridge_managed_session(websocket, session)
        return
    if _names_an_agent(websocket, workspace):
        await _fail(websocket, "the agent is not running", _NO_SESSION_CLOSE_CODE)
        return
    # A bare `?agent=agent` has no allow-list argv and must fail, not spawn empty.
    if not argv:
        await _fail(
            websocket, f"no executable configured for agent: {agent}", _UNKNOWN_AGENT_CLOSE_CODE
        )
        return

    await _bridge_own_pty(websocket, argv, _resolve_cwd(websocket, workspace))


def _names_an_agent(websocket: WebSocket, workspace: str) -> bool:
    """True when the id names an agent workspace, so "not running" beats opening a bare shell."""
    if not workspace or workspace == MAIN_WORKSPACE:
        return False
    services = _services(websocket)
    cwd_for = getattr(services, "workspace_cwd", None) if services is not None else None
    return cwd_for(workspace) is not None if cwd_for is not None else False


async def _bridge_own_pty(websocket: WebSocket, argv: list[str], cwd: str) -> None:
    """A PTY that lives and dies with this socket — the plain terminal panel's behaviour."""
    queue: asyncio.Queue[str | None] = asyncio.Queue()
    session = PtySession(
        argv,
        on_output=queue.put_nowait,
        on_exit=lambda: queue.put_nowait(None),
        cwd=cwd,
    )
    pump_task = asyncio.create_task(_pump_output(websocket, queue))
    try:
        await _consume_input(websocket, session.write, session.resize, session.write_bytes)
    finally:
        session.close()
        pump_task.cancel()


async def _bridge_managed_session(websocket: WebSocket, session: AgentSessionPort) -> None:
    """Attaches to an agent's long-lived PTY: redraw its current screen, then follow it live."""
    queue = session.attach()
    pump_task = asyncio.create_task(_pump_output(websocket, queue, close_on_end=False))
    resynced = False

    def resize(rows: int, cols: int) -> None:
        # The first resize is this window reporting its own geometry; redraw once at that size.
        nonlocal resynced
        session.resize(rows, cols)
        if not resynced:
            resynced = True
            session.resync(queue)

    try:
        await _consume_input(websocket, session.write, resize, session.write_bytes)
    finally:
        # Deliberately not session.close(): closing a window must never kill the agent.
        session.detach(queue)
        pump_task.cancel()


async def _pump_output(
    websocket: WebSocket, queue: asyncio.Queue, close_on_end: bool = True
) -> None:
    try:
        while True:
            chunk = await queue.get()
            if chunk is None:
                break
            await websocket.send_text(_OUTPUT_TAG + chunk)
    except Exception:
        pass
    finally:
        if close_on_end:
            await _close_quietly(websocket)


async def _consume_input(
    websocket: WebSocket,
    write: Callable[[str], None],
    resize: Callable[[int, int], None],
    write_bytes: Callable[[bytes], None],
) -> None:
    """Reads input/binary/resize frames until the socket drops; unknown frames are ignored."""
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            if message.get("type") == "input":
                write(message.get("data", ""))
            elif message.get("type") == "binary":
                # xterm's onBinary is raw bytes (mouse reports); base64 keeps them out of the hop.
                try:
                    write_bytes(base64.b64decode(message.get("data", ""), validate=True))
                except (TypeError, ValueError, binascii.Error):
                    continue
            elif message.get("type") == "resize":
                try:
                    resize(int(message.get("rows", 24)), int(message.get("cols", 80)))
                except (TypeError, ValueError):
                    continue
    except WebSocketDisconnect:
        return


async def _fail(websocket: WebSocket, message: str, code: int) -> None:
    """Sends one error control frame the client renders inline, then closes with a distinct code."""
    await websocket.send_text(_ERROR_TAG + json.dumps({"type": "error", "message": message}))
    await websocket.close(code=code)


async def _close_quietly(websocket: WebSocket) -> None:
    """Closes the socket, ignoring the error when it is already closing/closed."""
    try:
        await websocket.close()
    except RuntimeError:
        pass


# Standalone app for running the terminal bridge alone; the graph bridge also mounts `router`.
app = FastAPI()
app.include_router(router)
