"""Custom-diagram routes: the library/style registry (not repo-scoped) plus the per-repo diagram
GET/-path. `type_id` is a path parameter everywhere, so a new type needs no restart -- nothing here
registers at import time the way DIAGRAMS does.

The in-app interview that used to author a new library entry from the canvas
(`codechroma-diagram-type` skill + its own draft/interview routes) is retired -- diagram-management
unification. The library itself, and every route below, are untouched: a definition can still be
saved by hand or by a direct PUT from a skill/API caller.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from codechroma.bridge.context_providers import CONTEXT_PROVIDERS
from codechroma.bridge.deps import Ws
from codechroma.bridge.overlays import OVERLAY_PROVIDERS
from codechroma.bridge.review import REVIEW_AGENT_FACTORIES
from codechroma.bridge.routes._body import json_body
from codechroma.bridge.routes.diagrams import (
    delete_diagram_artifact,
    diagram_path_response,
    get_diagram_context,
    resolve_diagram,
)
from codechroma.diagrams import library
from codechroma.diagrams.styles import STYLES

router = APIRouter()


def _require_valid_id(type_id: str) -> None:
    if not library.valid_type_id(type_id):
        raise HTTPException(status_code=400, detail=f"invalid diagram type id: {type_id!r}")


def _known_registries() -> dict[str, set[str]]:
    """The registered provider/agent-factory names a saved definition may reference."""
    return {
        "known_context_providers": set(CONTEXT_PROVIDERS),
        "known_overlay_providers": set(OVERLAY_PROVIDERS),
        "known_review_agents": set(REVIEW_AGENT_FACTORIES),
    }


def _style_summaries() -> list[dict]:
    return [
        {
            "id": style.id,
            "label": style.label,
            "description": style.description,
            "overrides": style.overrides,
        }
        for style in STYLES.values()
    ]


@router.get("/diagram-styles")
def get_diagram_styles() -> dict:
    """The render-style registry a saved definition's `style` field picks from."""
    return {"styles": _style_summaries()}


@router.get("/diagram-types")
def list_diagram_types() -> dict:
    """Every saved definition's summary -- id, title, description, style."""
    return {"types": library.list_types()}


@router.get("/diagram-types/{type_id}")
def get_diagram_type(type_id: str) -> dict:
    _require_valid_id(type_id)
    definition = library.load_type(type_id)
    if definition is None:
        raise HTTPException(status_code=404, detail=f"unknown diagram type: {type_id!r}")
    return definition


@router.put("/diagram-types/{type_id}")
async def put_diagram_type(type_id: str, request: Request) -> dict:
    """Creates or replaces a definition; the path's `type_id` wins over any `id` in the body."""
    _require_valid_id(type_id)
    body = await json_body(request)
    try:
        return library.save_type({**body, "id": type_id}, **_known_registries())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/diagram-types/{type_id}")
def delete_diagram_type(type_id: str) -> dict:
    _require_valid_id(type_id)
    if not library.delete_type(type_id):
        raise HTTPException(status_code=404, detail=f"unknown diagram type: {type_id!r}")
    return {"deleted": type_id}


# --- the per-repo diagram: resolved payload plus its -path (rest deleted, see single-canvas.md) ---


# Registered before the bare `{type_id}` GET, or `-path` requests would be captured by it and 404.
@router.get("/repos/{repo_id}/custom/{type_id}-path")
def get_custom_diagram_path(type_id: str, ws: Ws) -> dict:
    """Absolute location the bridge reads this diagram from, for the skill to write to."""
    _require_valid_id(type_id)
    return diagram_path_response(ws, f"custom/{type_id}", key_name="custom_path")


@router.get("/repos/{repo_id}/custom/{type_id}")
def get_custom_diagram(type_id: str, ws: Ws) -> dict:
    """One custom type's resolved payload -- via the registry's synthesized spec, like built-ins."""
    _require_valid_id(type_id)
    return resolve_diagram(ws, f"custom/{type_id}")


@router.get("/repos/{repo_id}/custom/{type_id}/context")
def get_custom_diagram_context(
    type_id: str, ws: Ws, source: str = "diff", feature: str | None = None
) -> dict:
    """A custom type's context envelope -- null fields today, same shape as every built-in."""
    _require_valid_id(type_id)
    return get_diagram_context(ws, f"custom/{type_id}", source=source, feature=feature)


@router.delete("/repos/{repo_id}/custom/{type_id}")
def delete_custom_diagram(type_id: str, ws: Ws) -> dict:
    """Deletes this repo's own custom-diagram instance; never the saved library type."""
    _require_valid_id(type_id)
    return {"deleted": delete_diagram_artifact(ws, f"custom/{type_id}")}
