"""The one live socket every canvas layer multiplexes over: WS /repos/{id}/events."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, WebSocket

from codechroma.bridge.deps import SocketServices, workspace_for
from codechroma.bridge.live import ConnectionManager

router = APIRouter()


async def hold_open(
    manager: ConnectionManager, websocket: WebSocket, key: str | None = None
) -> None:
    """Registers a consumer socket and parks until it drops; pushes come from broadcasts."""
    await manager.connect(websocket, key)
    try:
        while True:
            await websocket.receive_text()
    except Exception:  # includes WebSocketDisconnect -- either way the socket is gone.
        manager.disconnect(websocket)


@router.websocket("/repos/{repo_id}/events")
async def repo_events(websocket: WebSocket, services: SocketServices, repo_id: str) -> None:
    # Off-thread so a lazy workspace bring-up can't block the loop.
    key = (await asyncio.to_thread(workspace_for, repo_id, services)).id
    await hold_open(services.connections, websocket, key=key)
