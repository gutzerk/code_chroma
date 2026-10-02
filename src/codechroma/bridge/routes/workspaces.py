"""Which workspace the canvas is drawing, and whether it is ready to be drawn."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from codechroma.bridge.agents.manager import UnknownAgentError
from codechroma.bridge.deps import Services
from codechroma.bridge.workspaces import MAIN_ID

router = APIRouter()


@router.post("/workspaces/{workspace_id}/activate")
async def activate_workspace(workspace_id: str, services: Services) -> dict:
    """Makes a workspace the canvas's data source, kicking off its bring-up in the background."""
    if workspace_id != MAIN_ID and not services.registry.is_registered(workspace_id):
        raise HTTPException(status_code=404, detail=f"unknown workspace: {workspace_id}")
    try:
        services.agent_manager.set_active_workspace(workspace_id)
    except UnknownAgentError as exc:
        raise HTTPException(status_code=404, detail=f"unknown workspace: {workspace_id}") from exc
    state = services.registry.ensure_async(workspace_id)
    await services.connections.broadcast({"type": "workspace-activated", "id": workspace_id})
    return {"id": workspace_id, **state}


@router.get("/workspaces/{workspace_id}/status")
def get_workspace_status(workspace_id: str, services: Services) -> dict:
    """analyzing / ready / error plus a progress line — the canvas never waits in silence."""
    return {
        "id": workspace_id,
        **services.registry.state(workspace_id),
        "read_only": services.registry.is_read_only(workspace_id),
    }
