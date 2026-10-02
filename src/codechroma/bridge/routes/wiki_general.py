"""wiki-general's status/generate/update/output/cancel routes -- not routes/diagrams.py, on purpose.

Mirrors _register_generate_routes' shape (one skill-run kind's routes, keyed by
services.skill_agents) but hand-written rather than imported: this is the first agent-driven
generate route a canvas button calls directly (docs/planning/047-wiki-general's research finding
that no live C1/Patterns "Retry" button exists today), so it needs the read-only guard c1/patterns'
own agent-invoked routes never picked up -- WritableWs on generate/cancel, same as any other route
that mutates a checkout (bridge/deps.py::refuse_if_read_only). The POST .../status route is the
interactive counterpart (docs/architecture/diagram-skills.md's "Reporting generation status from an
interactive run"): a terminal-panel agent running this skill directly, not through the button,
reports its own generating/idle/error the same way SkillAgent.start()'s own subprocess does. Both
routes share `prepare_new_run()` (wiki_general_agent.py) to clear stale pages and ready the plain
wiki before a genuinely new run starts -- moved out of the skill's own prompt so it's guaranteed by
code instead of depending on the model doing it, and shared so neither route repeats the guard.

Two SkillAgent instances now share one artifact file (manifest.json): `KIND` (full rebuild) and
`KIND_UPDATE` (patches only affected pages, see wiki-general.md's "Staying current after a commit").
Both write the same file, so running them concurrently risks one's snapshot/restore clobbering the
other's fresh output -- `_refuse_if_other_running` blocks starting either while the other runs, and
every route that can start a run holds `run_lock(ws.id)` (wiki_general_agent.py) across that check
and the state flip, so two overlapping requests can't both pass the check before either flips state.
The POST .../status route also takes an optional `"kind"` field (defaulting to `KIND`, for the
older full-rebuild skill's un-updated prompt) so an interactively-run update reports through its own
SkillAgent instance instead of silently borrowing the full-rebuild one's job bookkeeping. Status/
output/cancel are merged across both instances, so the canvas sees one job regardless of which kind
is in flight, and the update route's callbacks ride the same "wiki-general"-flavored ping names
(`job_callbacks(KIND, ...)`, not KIND_UPDATE), so the frontend needs no second subscription.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Request

from codechroma.bridge.deps import Services, WritableWs, Ws
from codechroma.bridge.routes._body import json_body
from codechroma.bridge.routes._skill_jobs import job_callbacks, stop_and_notify
from codechroma.bridge.skill_agent import OnChange, SkillAgent
from codechroma.bridge.wiki_general_agent import (
    ALREADY_RUNNING,
    KIND_UPDATE,
    apply_update_delta,
    compute_clustering,
    compute_update_delta,
    has_documentable_content,
    is_stale,
    prepare_new_run,
    run_lock,
    stamp_generated_commit,
    wiki_general_manifest_path,
)
from codechroma.bridge.workspaces import Workspace
from codechroma.io import load_json_or_none
from codechroma.prompts import render_prompt

router = APIRouter()

KIND = "wiki-general"


def _stamp_on_success(ws: Workspace, on_status_change: OnChange) -> OnChange:
    """Wraps a status callback so a clean finish records the commit this tree now reflects."""

    async def wrapped(repo_id: str, state: dict) -> None:
        if state["state"] != "generating" and state.get("error") is None:
            stamp_generated_commit(ws)
        await on_status_change(repo_id, state)

    return wrapped


def _refuse_if_other_running(other: SkillAgent, ws: Workspace, label: str) -> None:
    """Both kinds write manifest.json -- never let one start while the other is mid-run."""
    if other.get_state(ws.id)["state"] == "generating":
        raise HTTPException(status_code=409, detail=f"a {label} run is already in progress")


def _active_agent(services: Services, ws: Workspace) -> SkillAgent:
    """Whichever wiki-general runner is generating for `ws`; the full-rebuild one otherwise."""
    update_agent = services.skill_agents[KIND_UPDATE]
    if update_agent.get_state(ws.id)["state"] == "generating":
        return update_agent
    return services.skill_agents[KIND]


@router.get("/repos/{repo_id}/wiki-general/status")
def get_wiki_general_status(ws: Ws, services: Services) -> dict:
    """Background-job state (either kind), whether wiki-general exists, and whether it's stale."""
    agent = services.skill_agents[KIND]
    manifest = load_json_or_none(wiki_general_manifest_path(ws.root, ws.id))
    has_wiki_general = manifest is not None and agent.validate(manifest)
    return {
        **_active_agent(services, ws).get_state(ws.id),
        "has_wiki_general": has_wiki_general,
        "stale": has_wiki_general and is_stale(ws, manifest),
        "empty": not has_documentable_content(ws),
    }


@router.post("/repos/{repo_id}/wiki-general/status")
async def set_wiki_general_status(ws: Ws, services: Services, request: Request) -> dict:
    """Lets an interactive skill run flip the state a headless run's own subprocess drives."""
    body = await json_body(request)
    kind = body.get("kind", KIND)
    if kind not in (KIND, KIND_UPDATE):
        raise HTTPException(status_code=400, detail=f"unrecognized kind: {kind!r}")
    agent = services.skill_agents[kind]
    other = services.skill_agents[KIND_UPDATE if kind == KIND else KIND]
    on_status_change, _ = job_callbacks(KIND, ws.emit)
    on_status_change = _stamp_on_success(ws, on_status_change)
    state = body.get("state")
    if state == "generating":
        async with run_lock(ws.id):
            _refuse_if_other_running(other, ws, "update" if kind == KIND else "generate")
            sync_error = await prepare_new_run(agent, ws, guard_content=kind == KIND)
            if sync_error is ALREADY_RUNNING:
                return agent.get_state(ws.id)
            if sync_error is not None:
                return await agent.mark_done(ws.id, on_status_change, sync_error)
            return await agent.mark_generating(ws.id, on_status_change)
    if state in ("idle", "error"):
        detail = None
        if state == "error":
            raw_detail = body.get("detail")
            has_detail = isinstance(raw_detail, str) and raw_detail
            detail = raw_detail if has_detail else "unspecified error"
        return await agent.mark_done(ws.id, on_status_change, detail)
    raise HTTPException(status_code=400, detail=f"unrecognized state: {state!r}")


@router.post("/repos/{repo_id}/wiki-general/generate")
async def generate_wiki_general(ws: WritableWs, services: Services) -> dict:
    """Starts the full-rebuild run unless one is in flight; rejects a read-only workspace."""
    agent = services.skill_agents[KIND]
    on_status_change, on_output = job_callbacks(KIND, ws.emit)
    on_status_change = _stamp_on_success(ws, on_status_change)
    async with run_lock(ws.id):
        _refuse_if_other_running(services.skill_agents[KIND_UPDATE], ws, "update")
        sync_error = await prepare_new_run(agent, ws)
        if sync_error is ALREADY_RUNNING:
            return agent.get_state(ws.id)
        if sync_error is not None:
            return await agent.mark_done(ws.id, on_status_change, sync_error)
        return await agent.start(ws.id, ws.root, on_status_change, on_output, workspace=ws)


@router.post("/repos/{repo_id}/wiki-general/update")
async def update_wiki_general(ws: WritableWs, services: Services) -> dict:
    """Recomputes clustering, applies every deletion, hands the skill only what's left to write."""
    agent = services.skill_agents[KIND_UPDATE]
    on_status_change, on_output = job_callbacks(KIND, ws.emit)
    on_status_change = _stamp_on_success(ws, on_status_change)
    async with run_lock(ws.id):
        _refuse_if_other_running(services.skill_agents[KIND], ws, "generate")
        try:
            delta = apply_update_delta(ws, compute_update_delta(ws))
        except Exception as exc:
            # A reanalyze/manifest failure must reach the canvas as an error, not crash the route.
            return await agent.mark_done(ws.id, on_status_change, str(exc))
        prompt = render_prompt(
            "wiki_general_update_agent",
            created_components_json=json.dumps(delta["components"]["created"], indent=2),
            rewritten_components_json=json.dumps(delta["components"]["rewritten"], indent=2),
            created_containers_json=json.dumps(delta["containers"]["created"], indent=2),
            rewritten_containers_json=json.dumps(delta["containers"]["rewritten"], indent=2),
        )
        return await agent.start(ws.id, ws.root, on_status_change, on_output, prompt)


@router.get("/repos/{repo_id}/wiki-general/clustering")
def get_wiki_general_clustering(ws: Ws) -> dict:
    """The fixed C2-join files[]/edges[] grouping Phase A must consume, never invent itself."""
    return compute_clustering(ws)


@router.get("/repos/{repo_id}/wiki-general/output")
def get_wiki_general_output(ws: Ws, services: Services) -> dict:
    """The active run's progress lines so far, so a canvas opened mid-run isn't blank."""
    return {"lines": _active_agent(services, ws).get_output(ws.id)}


@router.post("/repos/{repo_id}/wiki-general/cancel")
async def cancel_wiki_general(ws: WritableWs, services: Services) -> dict:
    """Cancels whichever kind is in flight: kills claude, rolls back manifest, pings canvases."""
    return await stop_and_notify(_active_agent(services, ws), ws.id, KIND, ws.emit)
