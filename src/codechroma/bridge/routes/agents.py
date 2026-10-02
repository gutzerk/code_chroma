"""Parallel agents: the cards, their worktrees, their PTYs, and publishing one as a PR."""

from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from codechroma.bridge.agents import bootstrap, main_branch, publish
from codechroma.bridge.agents import worktree as worktree_ops
from codechroma.bridge.agents.manager import (
    CONTEXT_KINDS,
    AgentRecord,
    UnknownAgentError,
    max_agents,
)
from codechroma.bridge.agents.sessions import agent_run_env
from codechroma.bridge.agents.worktree import WorktreeError
from codechroma.bridge.deps import Services
from codechroma.bridge.routes._body import as_list, json_body
from codechroma.bridge.services import BridgeServices
from codechroma.config import settings
from codechroma.terminal.agents import ALLOWED_AGENTS, agent_cli, resolved_cli_for

router = APIRouter()


def _session_id_poll_attempts() -> int:
    # The transcript appears just after `claude` spawns, so the id is polled for briefly.
    return settings.agents_routes.session_id_poll_attempts


def _session_id_poll_seconds() -> float:
    return settings.agents_routes.session_id_poll_seconds


@router.get("/agents/git-preflight")
def get_git_preflight(services: Services) -> dict:
    """Whether agents can run here at all, plus the first-commit plan when a repo has to be made."""
    return bootstrap.preflight(services.repo_root)


@router.post("/agents/git-init")
async def post_git_init(request: Request, services: Services) -> dict:
    """`git init` + `.gitignore` + the first commit, once the user confirmed what goes in."""
    body = await json_body(request)
    extra = [entry for entry in as_list(body.get("extra_ignores")) if isinstance(entry, str)]
    # A BootstrapError becomes a 400 via the table in bridge/errors.py.
    return await asyncio.to_thread(bootstrap.initialize, services.repo_root, extra)


@router.get("/agents/branch")
def get_branch(services: Services) -> dict:
    """What the branch switcher shows: main's current branch plus the ones it can switch to."""
    return {
        "current": main_branch.current_branch(services.repo_root),
        "branches": main_branch.switchable_branches(services.repo_root),
    }


def _live_agent_in_main_worktree(services: BridgeServices) -> AgentRecord | None:
    """A live agent whose `claude` sits in main's own tree, which a checkout swaps underneath it."""
    # `record.status` is stale until agent_payload refreshes it, so liveness comes off the session.
    main_root = services.agent_manager.main_root
    for record in services.agent_manager.list():
        session = services.agent_sessions.get(record.id)
        if session is None or not session.is_alive:
            continue
        if Path(record.worktree).resolve() == main_root:
            return record
    return None


def _refuse_if_live_agent_in_main(services: BridgeServices) -> None:
    """A checkout/pull swaps files under a live agent parked in main's own tree — refuse first."""
    squatter = _live_agent_in_main_worktree(services)
    if squatter is not None:
        raise HTTPException(
            status_code=409,
            detail=f"stop {squatter.title} first — it works directly in the main worktree",
        )


@router.post("/agents/branch")
async def post_branch(request: Request, services: Services) -> dict:
    """Checks main's working tree out to `{branch}`; refuses over a dirty tree or unknown name."""
    body = await json_body(request)
    branch = body.get("branch")
    if not isinstance(branch, str) or not branch:
        raise HTTPException(status_code=400, detail="branch is required")
    _refuse_if_live_agent_in_main(services)
    try:
        await asyncio.to_thread(main_branch.checkout, services.repo_root, branch)
    except main_branch.DirtyWorkingTreeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except main_branch.UnknownBranchError as exc:
        raise HTTPException(status_code=404, detail=f"unknown branch: {branch}") from exc
    await services.connections.broadcast({"type": "branch-changed", "branch": branch})
    branches = await asyncio.to_thread(main_branch.switchable_branches, services.repo_root)
    return {"current": branch, "branches": branches}


@router.post("/agents/branch/update")
async def post_branch_update(services: Services) -> dict:
    """Fast-forwards main's current branch from its upstream — PyCharm's Update, the safe form."""
    _refuse_if_live_agent_in_main(services)
    # update_branch returns the still-current branch, so no second rev-parse is needed here.
    branch = await asyncio.to_thread(main_branch.update_branch, services.repo_root)
    await services.connections.broadcast({"type": "branch-changed"})
    branches = await asyncio.to_thread(main_branch.switchable_branches, services.repo_root)
    return {"current": branch, "branches": branches}


@router.get("/agents")
def get_agents(services: Services) -> dict:
    """Every agent card plus which workspace the canvas should be drawing."""
    return {
        "agents": [agent_payload(services, r) for r in services.agent_manager.list()],
        "active_workspace": services.agent_manager.active_workspace,
        "max_agents": max_agents(),
    }


@router.post("/agents")
async def post_agent(request: Request, services: Services) -> dict:
    """Creates the branch, the worktree and the record; the agent process is started separately."""
    body = await json_body(request)
    title = body.get("title")
    if title is None:
        title = ""
    elif not isinstance(title, str):
        raise HTTPException(status_code=400, detail="title must be a string")
    kind = body.get("kind") if isinstance(body.get("kind"), str) else "claude"
    if kind not in ALLOWED_AGENTS:
        raise HTTPException(status_code=400, detail=f"unknown agent kind: {kind}")
    attach_to = body.get("attach_to")
    if attach_to is not None and not isinstance(attach_to, str):
        raise HTTPException(status_code=400, detail="attach_to must be a string")
    context = body.get("context")
    if context is not None and not isinstance(context, str):
        raise HTTPException(status_code=400, detail="context must be a string")
    context_kind = body.get("context_kind", "view")
    if context_kind not in CONTEXT_KINDS:
        raise HTTPException(status_code=400, detail="context_kind must be 'view' or 'task'")
    try:
        record = await asyncio.to_thread(
            services.agent_manager.create,
            title, kind, attach_to=attach_to, context=context, context_kind=context_kind,
        )
    except UnknownAgentError as exc:
        raise HTTPException(status_code=404, detail=f"unknown attach_to: {attach_to}") from exc
    except WorktreeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    services.registry.register(
        record.id, Path(record.worktree), shares_workspace_with=record.shares_workspace_with
    )
    payload = record.to_payload()
    await services.connections.broadcast({"type": "agent-added", "agent": payload})
    return payload


@router.post("/agents/{agent_id}/start")
async def post_agent_start(agent_id: str, request: Request, services: Services) -> dict:
    """Brings up the agent's PTY in its worktree; `{resume: true}` continues its last chat."""
    body = await json_body(request)
    record = _agent_or_404(services, agent_id)
    resume = body.get("resume") is True
    session_id = services.agent_manager.capture_session_id(agent_id) if resume else None
    if resume and not session_id:
        raise HTTPException(status_code=409, detail="this agent has no recorded session to resume")
    # A fresh start consumes pending context up front; "task" rides in argv, not a post-boot inject.
    pending = services.agent_manager.consume_context(agent_id) if not resume else None
    task_text = pending[0] if pending and pending[1] == "task" else None
    resolved = agent_cli(record.kind, session_id, initial_prompt=task_text)
    if resolved is None:
        raise HTTPException(status_code=400, detail=f"unknown agent kind: {record.kind}")
    argv, env_overrides = resolved
    # Provider env (base-url/token/model) merged under the workspace id: the id wins any collision.
    run_env = agent_run_env(agent_id, extra=env_overrides)
    # An AgentStartError becomes a 409 via the table in bridge/errors.py.
    session = services.agent_sessions.start(
        agent_id, argv, Path(record.worktree), kind=record.kind, env=run_env
    )
    # Only an `agent`-kind window reports what it launched; `claude` leaves `resolved_cli` empty.
    updated = services.agent_manager.mark_started(
        agent_id, session.pid, resolved_cli=resolved_cli_for(record.kind, argv)
    )
    if pending and pending[1] != "task":
        text, _kind = pending
        session.inject_when_idle(
            f"[Context] You were just launched from the CodeChroma canvas. "
            f"The user is currently looking at: {text}. "
            f"Please acknowledge you understand this context. Do not act on it or "
            f"start any work — just confirm you've read it and say you're ready.",
        )
    # Give up quietly after a few seconds and leave session_id null — that just disables Resume.
    services.track_session_id_task(
        asyncio.create_task(_capture_session_id_later(services, agent_id))
    )
    payload = agent_payload(services, updated)
    await broadcast_agent_status(services, agent_id, payload["status"])
    return payload


@router.post("/agents/{agent_id}/recreate-worktree")
async def post_recreate_worktree(agent_id: str, services: Services) -> dict:
    """Checks the branch out again after the directory was deleted; the work was never lost."""
    try:
        record = await asyncio.to_thread(services.agent_manager.recreate_worktree, agent_id)
    except UnknownAgentError as exc:
        raise HTTPException(status_code=404, detail=f"unknown agent: {agent_id}") from exc
    except WorktreeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    services.registry.register(record.id, Path(record.worktree))
    return agent_payload(services, record)


@router.post("/agents/{agent_id}/stop")
async def post_agent_stop(agent_id: str, services: Services) -> dict:
    """Kills the PTY and keeps the worktree and the branch — the work is not the process."""
    _agent_or_404(services, agent_id)
    services.agent_sessions.stop(agent_id)
    payload = agent_payload(services, services.agent_manager.mark_stopped(agent_id))
    await broadcast_agent_status(services, agent_id, payload["status"])
    return payload


@router.get("/agents/{agent_id}/pr-preflight")
def get_pr_preflight(agent_id: str, services: Services) -> dict:
    """What blocks creating a PR, so the button can be disabled with the reason as its label."""
    record = _agent_or_404(services, agent_id)
    return publish.preflight(
        Path(record.worktree), record.branch, worktree_ops.main_branch(services.repo_root),
        source_pr=record.source_pr,
    )


@router.post("/agents/{agent_id}/pr")
async def post_pr(agent_id: str, request: Request, services: Services) -> dict:
    """`{commit_dirty: bool}` -> push the branch and open the PR; returns the URL."""
    record = _agent_or_404(services, agent_id)
    body = await json_body(request)
    # Offloaded separately: an argument expression would still be evaluated on the event loop.
    main = await asyncio.to_thread(worktree_ops.main_branch, services.repo_root)
    # Minutes of blocking work: `git push`, `gh pr create`, a `claude -p` message. 409 on failure.
    url = await asyncio.to_thread(
        publish.create_pr,
        Path(record.worktree),
        record.branch,
        main,
        commit_dirty=body.get("commit_dirty") is True,
        source_pr=record.source_pr,
    )
    record.pr_url = url
    services.agent_manager.save()
    return {"pr_url": url, **agent_payload(services, record)}


@router.delete("/agents/{agent_id}")
async def delete_agent(
    agent_id: str,
    services: Services,
    worktree: bool = False,
    branch: bool = False,
    force: bool = False,
) -> dict:
    """Removes the card; the worktree and the branch only when explicitly asked for."""
    try:
        record = await asyncio.to_thread(
            services.agent_manager.delete,
            agent_id,
            remove_worktree=worktree,
            remove_branch=branch,
            force=force,
        )
    except UnknownAgentError as exc:
        raise HTTPException(status_code=404, detail=f"unknown agent: {agent_id}") from exc
    except WorktreeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    # After delete succeeds, never before: a refused delete must not kill a session that is staying.
    services.agent_sessions.stop(agent_id)
    # unregister ends in drop_live, which joins a bring-up thread; keep it off the loop.
    await asyncio.to_thread(services.registry.unregister, agent_id)
    await services.forget_workspace_runs(agent_id)
    await services.connections.broadcast({"type": "agent-removed", "id": agent_id})
    return {"status": "deleted", "id": record.id}


@router.patch("/agents/{agent_id}/window")
async def patch_agent_window(agent_id: str, request: Request, services: Services) -> dict:
    """Saves window geometry / minimized state, fired on mouse release, not per pointer move."""
    try:
        record = services.agent_manager.update_window(agent_id, await json_body(request))
    except UnknownAgentError as exc:
        raise HTTPException(status_code=404, detail=f"unknown agent: {agent_id}") from exc
    return record.window


def _agent_or_404(services: BridgeServices, agent_id: str) -> AgentRecord:
    try:
        return services.agent_manager.get(agent_id)
    except UnknownAgentError as exc:
        raise HTTPException(status_code=404, detail=f"unknown agent: {agent_id}") from exc


def agent_payload(services: BridgeServices, record: AgentRecord) -> dict:
    """One card with its status read from the live session registry, not from a stored field."""
    session = services.agent_sessions.get(record.id)
    if session is None:
        record.pid, record.status, record.exit_code = None, "stopped", None
    else:
        record.pid, record.status = session.pid, session.status
        record.exit_code = session.exit_code
    return record.to_payload()


async def broadcast_agent_status(services: BridgeServices, agent_id: str, status: str) -> None:
    """The LED's only input: one `agent-status` ping per real change, over the existing socket."""
    await services.connections.broadcast(
        {"type": "agent-status", "id": agent_id, "status": status}
    )


async def _capture_session_id_later(services: BridgeServices, agent_id: str) -> None:
    """Polls briefly for the transcript: it does not exist the instant the process spawns."""
    for _attempt in range(_session_id_poll_attempts()):
        await asyncio.sleep(_session_id_poll_seconds())
        try:
            if services.agent_manager.capture_session_id(agent_id):
                return
        except UnknownAgentError:
            return
