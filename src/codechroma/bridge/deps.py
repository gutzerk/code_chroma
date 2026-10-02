"""FastAPI dependencies every router shares: reaching the app's BridgeServices and its workspaces.

Routes take these via `Depends` instead of closing over module globals, which is what lets one
process host two apps over two repositories -- and what lets a test build an app around a temporary
repo without reloading a module.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request, WebSocket

from codechroma.bridge.services import BridgeServices
from codechroma.bridge.workspaces import Workspace


def services_for(request: Request) -> BridgeServices:
    """The services bundle `create_app` attached to this application."""
    return request.app.state.services


def socket_services(websocket: WebSocket) -> BridgeServices:
    """Same bundle for a WebSocket route, which gets no Request."""
    return websocket.app.state.services


Services = Annotated[BridgeServices, Depends(services_for)]
SocketServices = Annotated[BridgeServices, Depends(socket_services)]


def workspace_for(repo_id: str, services: Services) -> Workspace:
    """The workspace `repo_id` selects, built on first access; `main` for an unregistered id."""
    return services.registry.get(repo_id)


Ws = Annotated[Workspace, Depends(workspace_for)]


def refuse_if_read_only(ws: Workspace) -> None:
    """Every write into a workspace goes through here; a pull-request checkout is a view only."""
    # On the flag, not the id: an agent the user happens to title "PR fixes" is still writable.
    if ws.read_only:
        raise HTTPException(status_code=409, detail="a pull-request workspace is read-only")


def writable_workspace(ws: Ws) -> Workspace:
    """`workspace_for` plus the read-only guard, for the routes that mutate a checkout."""
    refuse_if_read_only(ws)
    return ws


WritableWs = Annotated[Workspace, Depends(writable_workspace)]
