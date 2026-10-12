"""Branch workspaces: reopen the project on another (or a new) branch in its own worktree."""

from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from codechroma.bridge.agents import main_branch, worktree
from codechroma.bridge.branches.manager import BranchInUseError, BranchRecord
from codechroma.bridge.deps import Services
from codechroma.bridge.routes._body import json_body
from codechroma.bridge.services import BridgeServices
from codechroma.bridge.workspaces import MAIN_ID

router = APIRouter()


@router.get("/branches")
def list_branch_workspaces(services: Services) -> dict:
    """Every branch workspace this project has open."""
    return {"branches": [record.to_payload() for record in services.branch_manager.list()]}


@router.get("/branches/choices")
def branch_choices(services: Services) -> dict:
    """Every local branch, each with the workspace already showing it (null when it is free)."""
    holders = _holders(services)
    names = main_branch.list_branches(services.repo_root)
    return {
        "current": main_branch.current_branch(services.repo_root),
        "branches": [
            {"name": name, "open": name in holders, "workspace": holders.get(name)}
            for name in names
        ],
    }


@router.post("/branches")
async def open_branch_workspace(request: Request, services: Services) -> dict:
    """Opens `branch` in a new worktree, or creates `new_branch` (from `start_point`) in one."""
    body = await json_body(request)
    branch, new_branch = body.get("branch"), body.get("new_branch")
    if isinstance(branch, str) == isinstance(new_branch, str):
        raise HTTPException(status_code=400, detail="send exactly one of branch or new_branch")
    start_point = body.get("start_point")
    if start_point is not None and not isinstance(start_point, str):
        raise HTTPException(status_code=400, detail="start_point must be a branch name")
    name, create = (branch, False) if isinstance(branch, str) else (new_branch, True)
    try:
        record = await asyncio.to_thread(_provision_blocking, services, name, create, start_point)
    except BranchInUseError as exc:
        raise HTTPException(
            status_code=409, detail={"message": str(exc), "workspace": exc.holder}
        ) from exc
    return record.to_payload()


@router.delete("/branches/{workspace_id}")
async def close_branch_workspace(
    workspace_id: str, services: Services, worktree_too: bool = False
) -> dict:
    """Forgets the workspace; its directory is removed only with `?worktree_too=true`."""
    # Unknown ids and git refusals become 404/409 through bridge/errors.py's table.
    record = await asyncio.to_thread(_close_blocking, services, workspace_id, worktree_too)
    await services.release_workspace(workspace_id)
    return {"status": "deleted", "id": record.id}


def _close_blocking(
    services: BridgeServices, workspace_id: str, worktree_too: bool
) -> BranchRecord:
    """Unloads before the directory goes: an analyze still writing graph.db would fail mid-write."""
    services.branch_manager.get(workspace_id)
    services.registry.drop_live(workspace_id)
    return services.branch_manager.delete(workspace_id, worktree_too)


def _provision_blocking(
    services: BridgeServices, name: str, create: bool, start_point: str | None
) -> BranchRecord:
    """The git half of opening one, offloaded because `worktree add` can take seconds."""
    if create:
        record = services.branch_manager.create_branch(name, start_point)
    else:
        record = services.branch_manager.open_branch(name, _holders(services))
    services.registry.register(record.id, Path(record.worktree))
    return record


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
