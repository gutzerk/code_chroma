"""The bridge application factory: one `create_app(repo_root)` per analyzed repository.

This module deliberately does **nothing** at import time. `server.py` calls `create_app()` once for
uvicorn and the frozen desktop bridge; a test calls it with a temporary repository and gets an
independent app, which is what replaced the old `importlib.reload(server)` fixture.

Startup ordering that matters: uvicorn runs the lifespan *before* it binds the listening socket, so
`launch.py`'s "wait for the port" and the desktop shell's `GET /health` poll both still mean "the
initial analyze is done" -- the same guarantee the old module-scope analyze gave them.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from codechroma.bridge import resources
from codechroma.bridge.errors import install_error_handler
from codechroma.bridge.git_cmd import ensure_excluded
from codechroma.bridge.routes import ROUTERS
from codechroma.bridge.services import BridgeServices
from codechroma.bridge.skill_sync import SKILL_EXCLUDE_PATTERNS, sync_all_skills
from codechroma.config import settings
from codechroma.terminal.server import router as terminal_router

# "uvicorn.error" is the logger uvicorn wires to the console at INFO, so these show in-terminal.
logger = logging.getLogger("uvicorn.error")

PROJECT_ROOT = Path(__file__).resolve().parents[3]


def _status_poll_seconds() -> float:
    # 4 Hz: the detector's own send debounce is the real limiter, this just samples often enough.
    return settings.bridge_app.status_poll_seconds


# How often the idle sweep runs; the threshold itself is settings.workspaces.idle_unload_seconds.
IDLE_SWEEP_SECONDS = 60


def default_repo_root() -> Path:
    """The repo `codechroma_BRIDGE_REPO_PATH` names; an absolute value wins over PROJECT_ROOT."""
    return PROJECT_ROOT / os.environ.get("codechroma_BRIDGE_REPO_PATH", "examples")


async def _poll_agent_statuses(services: BridgeServices) -> None:
    """Samples every live agent's screen and pushes only the changes the detector settled on."""
    from codechroma.bridge.routes.agents import broadcast_agent_status

    while True:
        await asyncio.sleep(_status_poll_seconds())
        try:
            # Offloaded: a pyte screen render plus a `ps` subprocess, four times a second.
            changes = await asyncio.to_thread(services.agent_sessions.poll_statuses)
        except Exception:
            logger.exception("agents: status poll failed")
            continue
        for agent_id, status in changes:
            await broadcast_agent_status(services, agent_id, status)


async def _unload_idle_workspaces(services: BridgeServices) -> None:
    """Periodically drops workspaces nobody touched; graph.db keeps their work on disk."""
    while True:
        await asyncio.sleep(IDLE_SWEEP_SECONDS)
        try:
            # Offloaded: drop_live joins a possibly still-analyzing bring-up thread.
            dropped = await asyncio.to_thread(services.registry.unload_idle)
        except Exception:
            logger.exception("workspaces: idle unload failed")
            continue
        for workspace_id in dropped:
            logger.info("workspaces: unloaded idle workspace %s", workspace_id)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    from codechroma.bridge.agents.autostart import auto_start_agents

    services: BridgeServices = app.state.services
    services.connections.bind_loop(asyncio.get_running_loop())
    services.registry.start_all()
    await auto_start_agents(services)
    status_poller = asyncio.create_task(_poll_agent_statuses(services))
    idle_sweeper = asyncio.create_task(_unload_idle_workspaces(services))
    try:
        yield
    finally:
        idle_sweeper.cancel()
        status_poller.cancel()
        services.registry.stop_all()
        # Closing the app kills the agents on purpose: no orphan writing to files behind your back.
        services.agent_sessions.stop_all()
        services.cancel_session_id_tasks()
        services.mark_all_agents_stopped()
        # Covers every headless runner (diagrams + review + research) this app owns.
        await services.cancel_skill_agents()


def create_app(repo_root: Path | None = None) -> FastAPI:
    """Builds an app over `repo_root`, analyzing now so the first request has a graph to serve."""
    root = Path(repo_root) if repo_root is not None else default_repo_root()
    # Every entry point needs this, not just launch.py -- else a skill-agent run has no SKILL.md.
    try:
        ensure_excluded(root, SKILL_EXCLUDE_PATTERNS)
        sync_all_skills(root)
    except OSError:
        logger.exception("bridge: could not install skills into %s", root)
    app = FastAPI(lifespan=lifespan)
    app.state.services = BridgeServices.create(root)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=os.environ.get(
            "codechroma_BRIDGE_CORS_ORIGINS",
            # Both loopback spellings: dev server and launcher can answer on either.
            "http://localhost:5173,http://127.0.0.1:5173",
        ).split(","),
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["*"],
    )
    # One handler for every domain error, so a route only catches to reword the message.
    install_error_handler(app)
    # Serve the PTY terminal bridge on this same port so the canvas's terminal panel connects.
    app.include_router(terminal_router)
    for router in ROUTERS:
        app.include_router(router)

    @app.get("/health")
    def health() -> dict:
        """Readiness probe: answering means the lifespan startup, and so the analyze, finished."""
        return {"status": "ok", "repo": str(root)}

    # Mounted last so /repos/... wins over this catch-all; via the module since tests monkeypatch.
    spa_dir = resources.resource_path("web")
    if spa_dir.is_dir():
        app.mount("/", StaticFiles(directory=spa_dir, html=True), name="spa")

    return app
