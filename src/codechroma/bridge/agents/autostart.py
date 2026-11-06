"""Brings every persisted agent's PTY back up when the bridge boots.

Runs from `app.py`'s async `lifespan()` -- the only place with a running event loop, since
`AgentManager.reconcile()` (called synchronously, before `lifespan()`, before any loop exists)
already reset every record to `stopped`/`pid=None`. Resumes the last chat when a session id
survived the previous run, starts fresh otherwise; a lost worktree or an unstartable agent is
skipped so one bad apple never blocks the rest.
"""

from __future__ import annotations

import logging
from pathlib import Path
from uuid import uuid4

from codechroma.bridge.agents.live_status import AgentError
from codechroma.bridge.agents.manager import AgentRecord
from codechroma.bridge.agents.session_ownership import file_for
from codechroma.bridge.agents.sessions import AgentStartError, agent_run_env
from codechroma.bridge.services import BridgeServices
from codechroma.io import utc_now
from codechroma.terminal.agents import agent_launch, resolved_cli_for

logger = logging.getLogger("uvicorn.error")


async def auto_start_agents(services: BridgeServices, question_mcp=None) -> None:
    """One agent's failure to start is logged and skipped, never raised past this loop."""
    for record in services.agent_manager.list():
        if record.worktree_lost or services.agent_sessions.get(record.id) is not None:
            continue
        try:
            _auto_start_one(services, record, question_mcp)
        except Exception as exc:
            logger.exception("agents: auto-start failed for %s", record.id)
            _fail(record, str(exc))


def _fail(record: AgentRecord, message: str) -> None:
    """A failed auto-start is the agent's error until a start succeeds or it is dismissed."""
    record.start_error = AgentError(message, utc_now())


def _auto_start_one(services: BridgeServices, record: AgentRecord, question_mcp=None) -> None:
    """Resumes the last chat when a session id survived, starts fresh otherwise."""
    session_id = services.agent_manager.capture_session_id(record.id)
    new_session_id = str(uuid4()) if not session_id else None
    mcp = question_mcp.endpoint_for(record.id) if question_mcp is not None else None
    launch = agent_launch(
        record.kind, session_id, mcp=mcp, new_session_id=new_session_id,
        session_tracking_file=file_for(services.agent_manager.main_root, str(uuid4())),
        workdir=Path(record.worktree),
    )
    if launch is None:
        logger.error("agents: unknown kind %r for %s, skipping auto-start", record.kind, record.id)
        _fail(record, f"unknown agent kind: {record.kind}")
        return
    argv = launch.argv
    # Provider env merged under the workspace id, which wins on any collision (same as the route).
    run_env = agent_run_env(record.id, extra=launch.env)
    try:
        session = services.agent_sessions.start(
            record.id, argv, Path(record.worktree), kind=launch.detector_kind, env=run_env,
            clear=launch.clear,
        )
    except AgentStartError as exc:
        logger.warning("agents: could not auto-start %s: %s", record.id, exc)
        _fail(record, str(exc))
        return
    record.start_error = None
    services.agent_manager.mark_started(
        record.id, session.pid, resolved_cli=resolved_cli_for(record.kind, argv)
    )
    services.agent_manager.record_session_launch(record.id, session)
