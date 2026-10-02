"""Brings every persisted agent's PTY back up when the bridge boots.

Runs from `app.py`'s async `lifespan()` -- the only place with a running event loop, since
`AgentManager.reconcile()` (called synchronously, before `lifespan()`, before any loop exists)
already reset every record to `stopped`/`pid=None`. Resumes the last chat when a session id
survived the previous run, starts fresh otherwise; a lost worktree or an unstartable agent is
skipped so one bad apple never blocks the rest.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from codechroma.bridge.agents.manager import AgentRecord
from codechroma.bridge.agents.sessions import AgentStartError, agent_run_env
from codechroma.bridge.services import BridgeServices
from codechroma.terminal.agents import agent_cli, resolved_cli_for

logger = logging.getLogger("uvicorn.error")


async def auto_start_agents(services: BridgeServices) -> None:
    """One agent's failure to start is logged and skipped, never raised past this loop."""
    for record in services.agent_manager.list():
        if record.worktree_lost or services.agent_sessions.get(record.id) is not None:
            continue
        try:
            _auto_start_one(services, record)
        except Exception:
            logger.exception("agents: auto-start failed for %s", record.id)


def _auto_start_one(services: BridgeServices, record: AgentRecord) -> None:
    """Resumes the last chat when a session id survived, starts fresh otherwise."""
    from codechroma.bridge.routes.agents import _capture_session_id_later

    session_id = services.agent_manager.capture_session_id(record.id)
    resolved = agent_cli(record.kind, session_id)
    if resolved is None:
        logger.error("agents: unknown kind %r for %s, skipping auto-start", record.kind, record.id)
        return
    argv, env_overrides = resolved
    # Provider env merged under the workspace id, which wins on any collision (same as the route).
    run_env = agent_run_env(record.id, extra=env_overrides)
    try:
        session = services.agent_sessions.start(
            record.id, argv, Path(record.worktree), kind=record.kind, env=run_env
        )
    except AgentStartError as exc:
        logger.warning("agents: could not auto-start %s: %s", record.id, exc)
        return
    services.agent_manager.mark_started(
        record.id, session.pid, resolved_cli=resolved_cli_for(record.kind, argv)
    )
    services.track_session_id_task(
        asyncio.create_task(_capture_session_id_later(services, record.id))
    )
