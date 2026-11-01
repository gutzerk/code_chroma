"""Worktree tabs: each branch record is one tab (worktree + git branch) the canvas can show."""

from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from codechroma.bridge.agents import worktree
from codechroma.bridge.branches.manager import BranchRecord
from codechroma.bridge.deps import Services
from codechroma.bridge.routes._body import json_body
from codechroma.bridge.services import BridgeServices
from codechroma.bridge.workspaces import MAIN_ID

router = APIRouter()


@router.get("/branches")
def list_branch_workspaces(services: Services) -> dict:
    """Every worktree tab this project has, each with its uncommitted-entry count."""
    return {
        "branches": services.branch_manager.payloads(),
        "active": services.branch_manager.active,
    }


@router.post("/branches/ensure")
async def ensure_branch_workspaces(services: Services) -> dict:
    """Creates `wt-1` only when no tab exists; otherwise returns what is there."""
    await asyncio.to_thread(_ensure_blocking, services)
    return {
        "branches": services.branch_manager.payloads(),
        "active": services.branch_manager.active,
    }


@router.post("/branches/new")
async def new_branch_workspace(request: Request, services: Services) -> dict:
    """A new tab off fresh main; `{name}` is optional (the first free `wt-N` otherwise)."""
    body = await json_body(request)
    name = body.get("name")
    if name is not None and not isinstance(name, str):
        raise HTTPException(status_code=400, detail="name must be a string")
    record, fetched, warning = await asyncio.to_thread(_create_blocking, services, name)
    return {"branch": record.to_payload(), "fetched": fetched, "warning": warning}


@router.put("/branches/active")
async def put_active_branch_workspace(request: Request, services: Services) -> dict:
    """Remembers which tab is in front."""
    body = await json_body(request)
    workspace_id = body.get("id")
    if not isinstance(workspace_id, str) or not workspace_id:
        raise HTTPException(status_code=400, detail="id is required")
    services.branch_manager.set_active(workspace_id)
    return {"active": workspace_id}


@router.patch("/branches/{workspace_id}")
async def rename_branch_workspace(
    workspace_id: str, request: Request, services: Services
) -> dict:
    """Renames the tab and its git branch; the id and the worktree path stay stable."""
    body = await json_body(request)
    name = body.get("name")
    if not isinstance(name, str) or not name.strip():
        raise HTTPException(status_code=400, detail="name is required")
    previous = services.branch_manager.get(workspace_id).branch
    record = await asyncio.to_thread(
        services.branch_manager.rename, workspace_id, name, lambda: _holders(services)
    )
    services.agent_manager.rename_workspace_branch(workspace_id, previous, record.branch)
    return record.to_payload()


@router.delete("/branches/{workspace_id}")
async def close_branch_workspace(
    workspace_id: str, services: Services, worktree_too: bool = False
) -> dict:
    """Closes the tab and the agents on it; its directory goes only with `?worktree_too=true`."""
    # Unknown ids and git refusals become 404/409 through bridge/errors.py's table.
    removed_agents = await asyncio.to_thread(_close_blocking, services, workspace_id, worktree_too)
    for agent_id in removed_agents:
        await asyncio.to_thread(services.registry.unregister, agent_id)
        await services.forget_workspace_runs(agent_id)
        await services.connections.broadcast({"type": "agent-removed", "id": agent_id})
    await services.release_workspace(workspace_id)
    await services.connections.broadcast({"type": "branch-removed", "id": workspace_id})
    return {"status": "deleted", "id": workspace_id}


def _ensure_blocking(services: BridgeServices) -> None:
    """Provisions and registers the first tab; a no-op when any record exists."""
    had = {record.id for record in services.branch_manager.list()}
    for record in services.branch_manager.ensure_any():
        if record.id not in had:
            services.registry.register(record.id, Path(record.worktree))


def _create_blocking(
    services: BridgeServices, name: str | None
) -> tuple[BranchRecord, bool, str | None]:
    """The git half of a new tab, offloaded because fetch and `worktree add` take seconds."""
    record, fetched, warning = services.branch_manager.create_next(name)
    services.registry.register(record.id, Path(record.worktree))
    return record, fetched, warning


def _close_blocking(services: BridgeServices, workspace_id: str, worktree_too: bool) -> list[str]:
    """Unloads before the directory goes (analyze writes graph.db); reloads if git refuses."""
    services.branch_manager.get(workspace_id)
    doomed = services.agent_manager.ids_for_workspace(workspace_id)
    for agent_id in doomed:
        services.agent_sessions.stop(agent_id)
    if worktree_too:
        services.registry.drop_live(workspace_id)
    try:
        services.branch_manager.delete(workspace_id, worktree_too)
    except worktree.WorktreeError:
        if worktree_too:
            services.registry.ensure_async(workspace_id)
        raise
    return services.agent_manager.remove_for_workspace(workspace_id)


def _holders(services: BridgeServices) -> dict[str, str | None]:
    """branch -> id of the workspace that has it checked out (None: a worktree we don't track)."""
    root = services.repo_root.resolve()
    by_path: dict[Path, str] = {root: MAIN_ID}
    for record in services.branch_manager.list():
        by_path[Path(record.worktree).resolve()] = record.id
    for agent in services.agent_manager.list():
        by_path.setdefault(Path(agent.worktree).resolve(), agent.id)
    holders: dict[str, str | None] = {}
    for entry in worktree.list_worktrees(root):
        name, path = entry.get("branch"), entry.get("path")
        if name and path:
            holders[name] = by_path.get(Path(path).resolve())
    return holders
