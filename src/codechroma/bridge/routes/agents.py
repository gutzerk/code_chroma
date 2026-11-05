"""Parallel agents: the cards, their worktrees, their PTYs, and publishing one as a PR."""

from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request

from codechroma.bridge.agents import bootstrap, publish
from codechroma.bridge.agents import worktree as worktree_ops
from codechroma.bridge.agents.agent_hook import PERMISSION_WAIT_SECONDS
from codechroma.bridge.agents.live_status import (
    STATUS_ERROR,
    STATUS_STOPPED,
    STATUS_WORKING,
    AgentError,
    iso,
    utc_now,
)
from codechroma.bridge.agents.manager import (
    CONTEXT_KINDS,
    AgentRecord,
    UnknownAgentError,
    _clean_context,
    max_agents,
)
from codechroma.bridge.agents.session_ownership import file_for
from codechroma.bridge.agents.sessions import AgentStartError, agent_run_env
from codechroma.bridge.agents.worktree import WorktreeError
from codechroma.bridge.deps import Services
from codechroma.bridge.routes._body import as_list, json_body
from codechroma.bridge.services import BridgeServices
from codechroma.bridge.workspaces import BRANCH_ID_PREFIX, MAIN_ID
from codechroma.diagrams import kinds
from codechroma.questions.launch import bearer_token
from codechroma.questions.mcp_server import QuestionAuthError
from codechroma.terminal.agents import ALLOWED_AGENTS, agent_launch, resolved_cli_for

router = APIRouter()

# The status fields every agent payload and `agent-status` event carry.
STATUS_FIELDS = ("status", "status_since", "activity", "pending_permission", "error")


def _diagram_hint(body: dict) -> dict:
    """The Draw dialog's type and request off a POST /agents body, or a 400."""
    hint: dict = {}
    diagram_type = body.get("diagram_type")
    if diagram_type is not None:
        if diagram_type not in kinds.kind_ids():
            raise HTTPException(status_code=400, detail=f"unknown diagram_type: {diagram_type}")
        hint["diagram_type"] = diagram_type
    request = body.get("diagram_request")
    if request is not None:
        if not isinstance(request, str):
            raise HTTPException(status_code=400, detail="diagram_request must be a string")
        if len(request.strip()) > kinds.max_request_chars():
            raise HTTPException(
                status_code=400,
                detail=f"diagram_request must be at most {kinds.max_request_chars()} characters",
            )
        hint["diagram_request"] = _clean_context(request)
    return hint


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
    workspace = body.get("workspace")
    if workspace is not None and not isinstance(workspace, str):
        raise HTTPException(status_code=400, detail="workspace must be a string")
    context = body.get("context")
    if context is not None and not isinstance(context, str):
        raise HTTPException(status_code=400, detail="context must be a string")
    context_kind = body.get("context_kind", "view")
    if context_kind not in CONTEXT_KINDS:
        raise HTTPException(status_code=400, detail="context_kind must be 'view' or 'task'")
    diagram = _diagram_hint(body)
    if attach_to == MAIN_ID:
        raise HTTPException(status_code=400, detail="agents cannot attach to main")
    if attach_to is None and not workspace:
        raise HTTPException(status_code=400, detail="workspace is required")
    if workspace:
        if not workspace.startswith(BRANCH_ID_PREFIX):
            raise HTTPException(
                status_code=400,
                detail=f"workspace must be a worktree tab id, not '{workspace}'",
            )
        if services.branch_manager.find_by_id(workspace) is None:
            raise HTTPException(status_code=404, detail=f"unknown workspace: {workspace}")
    try:
        record = await asyncio.to_thread(
            services.agent_manager.create,
            title, kind, attach_to=attach_to, context=context, context_kind=context_kind,
            diagram=diagram if context_kind == "task" and diagram.get("diagram_type") else None,
            workspace=workspace,
        )
    except UnknownAgentError as exc:
        raise HTTPException(
            status_code=404, detail=f"unknown attach_to: {attach_to or workspace}"
        ) from exc
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
    new_session_id = (
        None if resume or services.agent_sessions.is_running(agent_id) else str(uuid4())
    )
    # A fresh start consumes pending context up front; "task" rides in argv, not a post-boot inject.
    pending = services.agent_manager.consume_context(agent_id) if not resume else None
    task_text = pending[0] if pending and pending[1] == "task" else None
    mcp = request.app.state.question_mcp
    mcp.remember_base_url(str(request.base_url))
    launch = agent_launch(
        record.kind, session_id, initial_prompt=task_text, mcp=mcp.endpoint_for(agent_id),
        new_session_id=new_session_id,
        session_tracking_file=file_for(services.agent_manager.main_root, str(uuid4())),
        workdir=Path(record.worktree),
    )
    if launch is None:
        raise HTTPException(status_code=400, detail=f"unknown agent kind: {record.kind}")
    argv = launch.argv
    # Provider env (base-url/token/model) merged under the workspace id: the id wins any collision.
    run_env = agent_run_env(agent_id, extra=launch.env)
    # An AgentStartError becomes a 409 via the table in bridge/errors.py.
    try:
        session = services.agent_sessions.start(
            agent_id, argv, Path(record.worktree), kind=launch.detector_kind, env=run_env
        )
    except AgentStartError as exc:
        record.start_error = AgentError(str(exc), utc_now())
        await broadcast_agent_status(services, record)
        raise
    record.start_error = None
    # Only an `agent`-kind window reports what it launched; `claude` leaves `resolved_cli` empty.
    updated = services.agent_manager.mark_started(
        agent_id, session.pid, resolved_cli=resolved_cli_for(record.kind, argv)
    )
    services.agent_manager.record_session_launch(agent_id, session)
    if pending and pending[1] != "task":
        text, _kind = pending
        session.inject_when_idle(
            f"[Context] You were just launched from the CodeChroma canvas. "
            f"The user is currently looking at: {text}. "
            f"Please acknowledge you understand this context. Do not act on it or "
            f"start any work — just confirm you've read it and say you're ready.",
        )
    payload = agent_payload(services, updated)
    await broadcast_agent_status(services, updated)
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
    stopped = services.agent_manager.mark_stopped(agent_id)
    payload = agent_payload(services, stopped)
    await broadcast_agent_status(services, stopped)
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
    record.pid = session.pid if session is not None else None
    record.exit_code = session.exit_code if session is not None else None
    previous = record.status
    activity = pending = error = None
    if record.start_error is not None:
        status, since, error = STATUS_ERROR, record.start_error.at, record.start_error
    elif session is not None:
        live = session.snapshot()
        status, since, activity, pending = live.status, live.since, live.activity, live.pending
        error = session.error if status == STATUS_ERROR else None
    else:
        status, since = STATUS_STOPPED, None
    record.status = status
    if since is not None:
        record.status_since = iso(since)
    elif previous != STATUS_STOPPED or record.status_since is None:
        record.status_since = iso(utc_now())
    working = activity is not None and status == STATUS_WORKING
    record.activity = activity.to_json() if working and activity is not None else None
    record.pending_permission = pending.to_json() if pending is not None else None
    record.error = error.to_json() if error is not None else None
    return record.to_payload()


async def broadcast_agent_status(services: BridgeServices, record: AgentRecord) -> None:
    """The LED's only input: one `agent-status` event per real change, over the existing socket."""
    payload = agent_payload(services, record)
    await services.connections.broadcast(
        {"type": "agent-status", "id": record.id, **{key: payload[key] for key in STATUS_FIELDS}}
    )


async def broadcast_agent(services: BridgeServices, agent_id: str) -> None:
    """Pushes one agent's status fields; an agent deleted meanwhile is skipped."""
    try:
        record = services.agent_manager.get(agent_id)
    except UnknownAgentError:
        return
    await broadcast_agent_status(services, record)


def _hook_authorized(request: Request, agent_id: str) -> bool:
    """Whether the bearer token is the hook token of exactly this agent's workspace."""
    try:
        token = bearer_token(request.headers)
        return request.app.state.question_mcp.workspace_id_for(token) == agent_id
    except QuestionAuthError:
        return False


@router.post("/agents/{agent_id}/hook")
async def post_agent_hook(agent_id: str, request: Request, services: Services) -> dict:
    """One Claude Code hook report; a PermissionRequest waits briefly for the canvas's decision."""
    if not _hook_authorized(request, agent_id):
        raise HTTPException(status_code=401, detail="invalid or missing workspace token")
    record = _agent_or_404(services, agent_id)
    body = await json_body(request)
    session = services.agent_sessions.get(agent_id)
    if session is None:
        return {"ok": True}
    outcome = session.apply_hook(body)
    if outcome.changed:
        await broadcast_agent_status(services, record)
    if outcome.decision is None:
        return {"ok": True}
    try:
        decision = await asyncio.wait_for(
            asyncio.shield(asyncio.wrap_future(outcome.decision)), PERMISSION_WAIT_SECONDS
        )
    except TimeoutError:
        decision = None
    if decision is None and session.expire_permission(outcome.request_id or ""):
        await broadcast_agent_status(services, record)
    return {"decision": decision}


@router.post("/agents/{agent_id}/seen")
async def post_agent_seen(agent_id: str, services: Services) -> dict:
    """The user looked at the agent: done becomes idle."""
    record = _agent_or_404(services, agent_id)
    session = services.agent_sessions.get(agent_id)
    if session is not None and session.mark_seen():
        await broadcast_agent_status(services, record)
    return agent_payload(services, record)


@router.post("/agents/{agent_id}/dismiss-error")
async def post_agent_dismiss_error(agent_id: str, services: Services) -> dict:
    """The user closed the error: the agent reads as stopped."""
    record = _agent_or_404(services, agent_id)
    had_error = record.start_error is not None
    record.start_error = None
    session = services.agent_sessions.get(agent_id)
    if (session is not None and session.dismiss_error()) or had_error:
        await broadcast_agent_status(services, record)
    return agent_payload(services, record)


@router.post("/agents/{agent_id}/permission")
async def post_agent_permission(agent_id: str, request: Request, services: Services) -> dict:
    """Allows or denies the PermissionRequest the agent's hook is waiting on."""
    record = _agent_or_404(services, agent_id)
    body = await json_body(request)
    decision = body.get("decision")
    if decision not in ("allow", "deny"):
        raise HTTPException(status_code=400, detail="decision must be 'allow' or 'deny'")
    request_id = body.get("request_id") if isinstance(body.get("request_id"), str) else ""
    session = services.agent_sessions.get(agent_id)
    if session is None or not session.decide(request_id, decision):
        raise HTTPException(status_code=404, detail=f"no pending permission request: {request_id}")
    await broadcast_agent_status(services, record)
    return agent_payload(services, record)
