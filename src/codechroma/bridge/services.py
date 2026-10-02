"""Everything one bridge instance owns, built together so routes receive it instead of reaching out.

`server.py` used to hold all of this as module globals assembled at import time, which made "point
the bridge at a different repository" mean `importlib.reload`. One `BridgeServices` per app is the
same bundle with an owner: `create_app(repo_root)` builds it, `app.state.services` holds it, and a
route reads it through the `services_for` dependency -- so two apps over two repositories can exist
in one process, which is what makes the route tests cheap.

Ordering inside `create()` is load-bearing and is the same order server.py's module scope ran in:
agents are registered before PRs, and `workspace_guard`/`revalidate_active_workspace` come last,
once every non-agent workspace id is known.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from pathlib import Path

from codechroma.bridge.agents.manager import AgentManager
from codechroma.bridge.agents.sessions import AgentSessionRegistry
from codechroma.bridge.diagram_registry import DIAGRAMS
from codechroma.bridge.live import ConnectionManager
from codechroma.bridge.prs import importer as pr_importer
from codechroma.bridge.prs.manager import PrManager
from codechroma.bridge.research_agent import ResearchQueryLog
from codechroma.bridge.review import REVIEW_AGENT_FACTORIES
from codechroma.bridge.skill_agent import SkillAgent
from codechroma.bridge.skill_spec import COMPOSITE_SPECS
from codechroma.bridge.wiki_general_agent import KIND as WIKI_GENERAL_KIND
from codechroma.bridge.wiki_general_agent import KIND_UPDATE as WIKI_GENERAL_UPDATE_KIND
from codechroma.bridge.wiki_general_agent import (
    build_wiki_general_agent,
    build_wiki_general_update_agent,
)
from codechroma.bridge.workspaces import Workspace, WorkspaceRegistry
from codechroma.diagrams.registry import BUILTIN_TYPES

logger = logging.getLogger("uvicorn.error")


def _build_skill_agents() -> dict[str, SkillAgent]:
    """One runner per skill-run kind -- registry.py's built-ins, review agents, COMPOSITE_SPECS."""
    # DIAGRAMS still supplies each kind's live-agent closure until US1 (T018) retires it (037).
    agents = {kind: DIAGRAMS[kind].agent_factory() for kind in BUILTIN_TYPES}
    # A two-way splice, not a merge (research.md Decision 1) -- no `review` means no agent key.
    for definition in (BUILTIN_TYPES[kind] for kind in BUILTIN_TYPES):
        if definition.review is None:
            continue
        factory = REVIEW_AGENT_FACTORIES.get(definition.review.agent_factory)
        if factory is not None:
            agents[definition.review.agent_factory] = factory()
    agents.update({kind: spec.agent_factory() for kind, spec in COMPOSITE_SPECS.items()})
    # Not a BUILTIN_TYPES/DIAGRAMS entry on purpose -- see wiki_general_agent.py's module docstring.
    agents[WIKI_GENERAL_KIND] = build_wiki_general_agent()
    agents[WIKI_GENERAL_UPDATE_KIND] = build_wiki_general_update_agent()
    return agents


@dataclass
class BridgeServices:
    """One bridge instance's collaborators; `create()` is the only supported way to build one."""

    repo_root: Path
    connections: ConnectionManager
    trace_connections: ConnectionManager
    registry: WorkspaceRegistry
    agent_manager: AgentManager
    pr_manager: PrManager
    agent_sessions: AgentSessionRegistry
    # Per-app runners: two apps in one process never share job state or leak cancels across.
    skill_agents: dict[str, SkillAgent] = field(default_factory=_build_skill_agents)
    research_queries: ResearchQueryLog = field(default_factory=ResearchQueryLog)
    # Held so shutdown can cancel a poll still waiting on a transcript that may never appear.
    session_id_tasks: set[asyncio.Task] = field(default_factory=set)

    @classmethod
    def create(cls, repo_root: Path) -> BridgeServices:
        """Builds and reconciles every collaborator; the registry analyzes `main` as it is built."""
        connections = ConnectionManager()
        registry = WorkspaceRegistry(repo_root, connections.broadcast_threadsafe)

        agent_manager = AgentManager(repo_root)
        agent_manager.reconcile()
        for record in agent_manager.list():
            registry.register(
                record.id, Path(record.worktree),
                shares_workspace_with=record.shares_workspace_with,
            )

        # Re-registered here: unregistered, `pr-12` resolves to *main* and draws it under its name.
        pr_manager = PrManager(repo_root)
        pr_manager.reconcile()
        agent_manager.pr_lookup = pr_manager.find_by_id
        for pr_record in pr_manager.list():
            registry.register(
                pr_record.id,
                Path(pr_record.worktree),
                base_ref=pr_importer.local_base_ref(pr_record.number),
                read_only=True,
                c1_source_root=registry.main.root,
            )

        # With every workspace registered, a deferred `active_workspace: "pr-12"` can be judged.
        agent_manager.workspace_guard = registry.is_registered
        agent_manager.revalidate_active_workspace()

        return cls(
            repo_root=repo_root,
            connections=connections,
            trace_connections=ConnectionManager(),
            registry=registry,
            agent_manager=agent_manager,
            pr_manager=pr_manager,
            # Its own registry: cancel_skill_agents() kills diagram runners, never these.
            agent_sessions=AgentSessionRegistry(),
        )

    async def cancel_skill_agents(self) -> None:
        """Kills every runner's in-flight jobs so a restart can't leave an orphan still writing."""
        for agent in self.skill_agents.values():
            await agent.cancel()

    async def forget_workspace_runs(self, repo_id: str) -> None:
        """Drops repo_id's state from every runner — call this once its workspace is deleted."""
        for agent in self.skill_agents.values():
            await agent.forget(repo_id)

    # --- convenience accessors the routes share ---

    @property
    def main(self) -> Workspace:
        return self.registry.main

    def workspace_cwd(self, workspace_id: str) -> str | None:
        """Where `?workspace=<id>` roots a shell; None when nothing is registered under that id."""
        # 🔴 From the registry: a registered non-agent workspace used to open its shell in main.
        root = self.registry.root_for(workspace_id)
        return str(root) if root is not None else None

    def mark_all_agents_stopped(self) -> None:
        """Shutdown bookkeeping: the PTYs are gone, so no card may claim a pid that is now dead."""
        for record in self.agent_manager.list():
            record.pid, record.status, record.exit_code = None, "stopped", None
        self.agent_manager.save()

    def track_session_id_task(self, task: asyncio.Task) -> None:
        """Keeps a strong reference to a fire-and-forget poll so it isn't garbage collected."""
        self.session_id_tasks.add(task)
        task.add_done_callback(self.session_id_tasks.discard)

    def cancel_session_id_tasks(self) -> None:
        for task in list(self.session_id_tasks):
            task.cancel()
        self.session_id_tasks.clear()
