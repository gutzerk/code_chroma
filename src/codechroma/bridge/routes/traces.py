"""Recorded execution traces, plus the producer/consumer socket pair a live `--stream` run uses."""

from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from codechroma.bridge.deps import SocketServices, Ws
from codechroma.bridge.routes.events import hold_open

router = APIRouter()


@router.get("/repos/{repo_id}/traces")
def get_traces(ws: Ws) -> list[dict]:
    """Every recorded execution trace, summarized for the canvas's trace picker."""
    return ws.list_traces()


@router.get("/repos/{repo_id}/traces/{trace_id}")
def get_trace(ws: Ws, trace_id: str) -> dict:
    """One recorded trace's full step list for playback, ordered by seq."""
    trace = ws.load_trace(trace_id)
    if isinstance(trace, dict) and trace:
        steps = trace.get("steps")
        if isinstance(steps, list):
            trace["steps"] = sorted(steps, key=lambda s: s.get("seq", 0))
        else:
            trace["steps"] = []
    return trace


@router.websocket("/repos/{repo_id}/trace-stream")
async def trace_stream(websocket: WebSocket, services: SocketServices, repo_id: str) -> None:
    """Canvas consumer socket: receives live {type:step} / {type:trace-end} events for repo_id."""
    await hold_open(services.trace_connections, websocket, repo_id)


@router.websocket("/repos/{repo_id}/trace-ingest")
async def trace_ingest(websocket: WebSocket, services: SocketServices, repo_id: str) -> None:
    """Producer socket (tracer --stream): relays each message to repo_id's own stream consumers."""
    await websocket.accept()
    try:
        while True:
            message = await websocket.receive_json()
            await services.trace_connections.broadcast(message, repo_id)
    except WebSocketDisconnect:
        return
    except Exception:
        return
