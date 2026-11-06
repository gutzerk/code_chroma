"""Resumes an idle claude agent in place after its window grew noticeably wider (C# WidenResume.cs).

Claude's classic renderer prints history as hard rows at the width it had then and never reprints
it, so the agent is restarted with `--resume` of its own session at the new size; the scrollback is
cleared first and the resumed process reprints the whole conversation at the new width. Any check
that fails leaves the old process running and reports no error.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4

from codechroma.bridge.agents.manager import AgentManager, UnknownAgentError
from codechroma.bridge.agents.session_ownership import FILE_ENV, file_for
from codechroma.bridge.agents.sessions import AgentSession, AgentSessionRegistry, agent_run_env
from codechroma.terminal.agents import agent_launch, resolved_cli_for

logger = logging.getLogger("uvicorn.error")

# How long an agent with an open ask_user question waits before it is checked again.
QUESTION_RETRY = timedelta(seconds=5)


def projects_dir() -> Path:
    """Claude Code's transcript root, honouring CLAUDE_CONFIG_DIR like the C# Transcripts."""
    configured = os.environ.get("CLAUDE_CONFIG_DIR", "").strip()
    base = Path(configured).expanduser() if configured else Path.home() / ".claude"
    return base / "projects"


def has_transcript(session_id: str, root: Path) -> bool:
    """Whether a project folder holds `<session_id>.jsonl`, so `--resume` has something to load."""
    if not session_id or os.sep in session_id or "/" in session_id:
        return False
    try:
        return any((d / f"{session_id}.jsonl").is_file() for d in root.iterdir() if d.is_dir())
    except OSError:
        return False


class WidenResume:
    """Restarts due agents with `--resume`; `asks_user(agent_id)` reports an open question."""

    def __init__(
        self,
        agents: AgentManager,
        sessions: AgentSessionRegistry,
        asks_user: Callable[[str], bool],
        mcp_for: Callable[[str], object | None] | None = None,
        projects_root: Path | None = None,
    ) -> None:
        self._agents = agents
        self._sessions = sessions
        self._asks_user = asks_user
        self._mcp_for = mcp_for
        self._projects_root = projects_root

    def sweep(self, now: datetime) -> list[str]:
        """Resumes every due agent; returns the ids that restarted."""
        return [
            s.agent_id for s in self._sessions.all() if s.widen_due(now) and self._resume(s, now)
        ]

    def _resume(self, session: AgentSession, now: datetime) -> bool:
        agent_id = session.agent_id
        try:
            record = self._agents.get(agent_id)
        except UnknownAgentError:
            return False
        if self._asking(agent_id):
            session.postpone_widen(now + QUESTION_RETRY)
            return False
        session_id = None if record.worktree_lost else self._agents.capture_session_id(agent_id)
        root = self._projects_root or projects_dir()
        # A session with no transcript yet cannot be resumed, and its banner is not worth a restart.
        if not session_id or not has_transcript(session_id, root):
            session.settle_width()
            return False
        mcp = self._mcp_for(agent_id) if self._mcp_for is not None else None
        launch = agent_launch(
            record.kind, session_id, mcp=mcp,
            session_tracking_file=file_for(self._agents.main_root, str(uuid4())),
            workdir=Path(record.worktree),
        )
        # The CLI may have changed since launch; only a tracked claude resumes the same session.
        if launch is None or FILE_ENV not in launch.env:
            session.settle_width()
            return False
        env = agent_run_env(agent_id, extra=launch.env)
        if not self._sessions.respawn(agent_id, launch.argv, Path(record.worktree), env):
            session.settle_width()
            return False
        self._agents.mark_started(
            agent_id, session.pid, resolved_cli=resolved_cli_for(record.kind, launch.argv)
        )
        self._agents.record_session_launch(agent_id, session)
        return True

    def _asking(self, agent_id: str) -> bool:
        """An unreadable canvas counts as asking, so the agent is left alone."""
        try:
            return self._asks_user(agent_id)
        except Exception:
            logger.exception("agents: could not read the questions of %s", agent_id)
            return True
