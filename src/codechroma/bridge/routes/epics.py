"""The Epics routes: one item (with optional stage expansion) and the AI-brief trio (start/attach,
poll, progress) -- a bespoke per-epic SkillAgent, not a DIAGRAMS kind (see epic_brief_agent.py).
The portfolio index moved out of this router: `epics` is a registered diagram kind now (a skill
writes epics.json, `diagram_registry.py`'s DIAGRAMS["epics"] resolves it), so the bare
`GET /repos/{id}/epics` serves the resolved diagram, and the requirements summary lives at
`GET /repos/{id}/epics/context` (via the `"epics"` context provider). The item/brief routes below
are independent of how the canvas diagram is drawn -- the brief reads a single work item directly.

The index/item pair is not a diagram-kind -- derived from the requirements/delivery sources,
nothing to generate. Its saved-layout pair was dropped in 016 Stage 6 -- epic positions live on
canvas.json now, so no route reads/writes an "epics" layout file anymore.
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException

from codechroma.bridge import epic_brief_agent, epic_brief_resolver, epics_resolver
from codechroma.bridge.deps import Services, WritableWs, Ws
from codechroma.bridge.diagram_registry import valid_epic_id
from codechroma.bridge.routes._skill_jobs import job_callbacks, stop_and_notify
from codechroma.bridge.routes.skill_runs import register_output_route
from codechroma.bridge.workspaces import Workspace
from codechroma.io import load_json_or_none
from codechroma.prompts import render_prompt
from codechroma.requirements.brief_models import EpicBrief

router = APIRouter()


def _read_brief(ws: Workspace, key: str, epic: dict | None) -> EpicBrief | None:
    data = load_json_or_none(epic_brief_agent.epic_brief_path(ws.root, key))
    if data is None:
        return None
    if epic is not None:
        data = epic_brief_resolver.resolve_brief(data, ws.root, epic)
    return EpicBrief.from_dict(data)


@router.get("/repos/{repo_id}/epics/items/{item_id}")
def get_epics_item(ws: Ws, item_id: str, expand: str | None = None) -> dict:
    """One WorkItem; `expand` names one stage node id to populate its sections. 404 if unknown."""
    item = epics_resolver.epics_item(ws.root, item_id, expand)
    if item is None:
        raise HTTPException(status_code=404, detail=f"unknown work item: {item_id!r}")
    return item


@router.post("/repos/{repo_id}/epics/{item_id}/brief")
async def start_epic_brief(
    item_id: str, ws: WritableWs, services: Services, force: bool = False
) -> dict:
    """Starts the brief skill, or attaches to one running; `force=true` regenerates a cached run."""
    epic = epics_resolver.epics_item(ws.root, item_id)
    if epic is None:
        raise HTTPException(status_code=404, detail=f"unknown work item: {item_id!r}")
    key = epic_brief_agent.job_key(ws.id, item_id)
    agent = services.skill_agents["epic-brief"]
    # Attach to an in-flight run FIRST -- a cached brief must not bypass the generate guard.
    live = agent.get_state(key)
    if live["state"] == "generating":
        return {"job_key": key, "brief": None, **live}
    # Skip the cached-brief shortcut on `force`: regeneration must re-run the skill, not echo disk.
    if not force:
        # Off the event loop: resolve_brief re-parses tasks.md, same as build_brief_bundle below.
        cached = await asyncio.to_thread(_read_brief, ws, key, epic)
        if cached is not None:
            return {"job_key": key, "brief": cached.to_dict(), "state": "idle", "error": None}

    on_status_change, on_output = job_callbacks(
        "epic-brief", ws.emit, job_key=key, item_id=item_id
    )
    # Off the event loop: build_brief_bundle's per-stage markdown re-parses are blocking file I/O.
    bundle = await asyncio.to_thread(
        epic_brief_agent.build_brief_bundle,
        ws.root,
        item_id,
        epic,
        epic_brief_agent.epic_brief_path(ws.root, key),
    )
    prompt = render_prompt(
        "epic_brief_agent", epic_id=item_id, job_key=key, bundle=json.dumps(bundle)
    )
    state = await agent.start(key, ws.root, on_status_change, on_output, prompt)
    return {"job_key": key, "brief": None, **state}


@router.get("/repos/{repo_id}/epics/{item_id}/brief")
def get_epic_brief(item_id: str, ws: Ws, services: Services) -> dict:
    """Current state of an epic's brief job, plus its brief once done."""
    key = epic_brief_agent.job_key(ws.id, item_id)
    state = services.skill_agents["epic-brief"].get_state(key)
    # Skipped mid-run (file's absent/half-written then anyway) -- halves a poller's disk reads.
    if state["state"] == "generating":
        brief = None
    else:
        epic = epics_resolver.epics_item(ws.root, item_id)
        brief = _read_brief(ws, key, epic)
    return {"job_key": key, "brief": brief.to_dict() if brief else None, **state}


@router.post("/repos/{repo_id}/epics/{item_id}/brief/cancel")
async def cancel_epic_brief(item_id: str, ws: Ws, services: Services) -> dict:
    """Cancels an in-flight brief run; the job resets to idle and its half-brief rolls back."""
    key = epic_brief_agent.job_key(ws.id, item_id)
    state = await stop_and_notify(
        services.skill_agents["epic-brief"], key, "epic-brief",
        ws.emit, job_key=key, item_id=item_id,
    )
    epic = epics_resolver.epics_item(ws.root, item_id)
    brief = await asyncio.to_thread(_read_brief, ws, key, epic)
    return {"job_key": key, "brief": brief.to_dict() if brief else None, **state}


def _epic_brief_output_key(params: dict[str, str], services: Services) -> str:
    """Resolves `repo_id` through the registry: an alias must land on the same job as `ws.id`."""
    canonical_id = services.registry.get(params["repo_id"]).id
    return epic_brief_agent.job_key(canonical_id, params["item_id"])


register_output_route(
    router,
    agent="epic-brief",
    output_path="/repos/{repo_id}/epics/{item_id}/brief/output",
    key=_epic_brief_output_key,
)


@router.get("/repos/{repo_id}/epics/{item_id}/brief/path")
def get_epic_brief_path(item_id: str, ws: Ws) -> dict:
    """Absolute location the skill writes this epic's brief to."""
    key = epic_brief_agent.job_key(ws.id, item_id)
    path = epic_brief_agent.epic_brief_path(ws.root, key)
    return {"repo_root": str(ws.root), "brief_path": str(path)}


@router.get("/repos/{repo_id}/epics/{item_id}/diagram-path")
def get_epic_diagram_path(item_id: str, ws: Ws) -> dict:
    """Absolute location the skill writes this epic's own diagram to (one file per epic).

    Since each epic is its own synthesized diagram kind (`epics/<epic_id>`, see
    `diagram_registry.py`), this is `ws.diagram_artifact_path` on that kind -- the per-epic
    `.codechroma/diagrams/epics/<epic_id>/<epic_id>.json` the draw-diagram skill overwrites.
    The id names a path segment on disk, so it must pass the same filesystem-safety check as
    `_synthesize_epics` -- otherwise a `..`-laced id would resolve outside the epics dir.
    """
    if not valid_epic_id(item_id):
        raise HTTPException(status_code=404, detail=f"unknown work item: {item_id!r}")
    path = ws.diagram_artifact_path(f"epics/{item_id}")
    return {"repo_root": str(ws.root), "diagram_path": str(path)}
