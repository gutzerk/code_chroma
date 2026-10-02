"""Every diagram type's routes, generated from `DIAGRAMS` -- plus the Impact change review's own.

`register_diagram_routes` is the whole reason adding a diagram type is one `DiagramSpec` entry: the
get/get-path/generate/status/output(/layout) septet is written once here and instantiated per kind.
The change review reuses only the generate/status/output trio -- its GET carries review comments and
a fingerprint the generic shape has no room for.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from codechroma.bridge.context_providers import CONTEXT_PROVIDERS
from codechroma.bridge.coverage import coverage_report
from codechroma.bridge.deps import Services, Ws
from codechroma.bridge.diagram_registry import DIAGRAMS, DiagramSpec
from codechroma.bridge.diagram_resolver import attach_staleness, authored_paths
from codechroma.bridge.overlays import attach_overlays, resolve_impact_changes
from codechroma.bridge.review import REVIEW_AGENT_FACTORIES, resolve_review
from codechroma.bridge.routes._body import json_body
from codechroma.bridge.routes._skill_jobs import job_callbacks, stop_and_notify
from codechroma.bridge.services import BridgeServices
from codechroma.bridge.wiki_context import WikiContextBundle, build_wiki_context
from codechroma.bridge.wiki_general_agent import wiki_general_dir
from codechroma.bridge.wiki_general_context import build_wiki_general_context
from codechroma.bridge.workspaces import Workspace
from codechroma.diagrams import library
from codechroma.diagrams.registry import BUILTIN_TYPES, get_definition
from codechroma.fingerprint import hash_lines
from codechroma.io import delete_file_if_exists
from codechroma.patterns.serialize import fingerprint_for

router = APIRouter()


def _register_generate_routes(
    kind: str,
    root_for: Callable[[Workspace], Path],
    supports_only_if_missing: bool = True,
    prompt_for: Callable[[str, str | None], str] | None = None,
) -> None:
    """Registers one skill-run kind's generate/status/output trio, shared by every diagram type."""

    @router.post(f"/repos/{{repo_id}}/{kind}/generate")
    async def generate_diagram(
        ws: Ws, services: Services, only_if_missing: bool = False,
        source: str = "diff", feature: str | None = None,
    ) -> dict:
        """Kicks off a headless skill run in the background, if none is running (read-only okay)."""
        agent = services.skill_agents[kind]
        on_status_change, on_output = job_callbacks(kind, ws.emit)
        # Set by the canvas's auto-trigger only: a diagram on disk is never overwritten unasked.
        already_has_one = agent.has_artifact(root_for(ws), ws.id)
        if only_if_missing and supports_only_if_missing and already_has_one:
            return agent.get_state(ws.id)
        prompt = prompt_for(source, feature) if prompt_for is not None else None
        return await agent.start(ws.id, ws.root, on_status_change, on_output, prompt=prompt)

    # One kind's background job state -- not `diagrams/status` below, which is artifact readiness.
    @router.get(f"/repos/{{repo_id}}/{kind}/status")
    def get_diagram_status(ws: Ws, services: Services) -> dict:
        """Current state of a background generation job for repo_id (defaults to idle)."""
        return services.skill_agents[kind].get_state(ws.id)

    @router.post(f"/repos/{{repo_id}}/{kind}/status")
    async def set_diagram_status(ws: Ws, services: Services, request: Request) -> dict:
        """Lets an interactive skill run flip the state a headless run's own subprocess drives."""
        agent = services.skill_agents[kind]
        on_status_change, _ = job_callbacks(kind, ws.emit)
        body = await json_body(request)
        state = body.get("state")
        if state == "generating":
            return await agent.mark_generating(ws.id, on_status_change)
        if state in ("idle", "error"):
            detail = None
            if state == "error":
                raw_detail = body.get("detail")
                has_detail = isinstance(raw_detail, str) and raw_detail
                detail = raw_detail if has_detail else "unspecified error"
            return await agent.mark_done(ws.id, on_status_change, detail)
        raise HTTPException(status_code=400, detail=f"unrecognized state: {state!r}")

    @router.post(f"/repos/{{repo_id}}/{kind}/cancel")
    async def cancel_diagram(ws: Ws, services: Services) -> dict:
        """Cancels an in-flight run: kills `claude`, rolls the artifact back, pings the canvases."""
        return await stop_and_notify(services.skill_agents[kind], ws.id, kind, ws.emit)

    @router.get(f"/repos/{{repo_id}}/{kind}/output")
    def get_diagram_output(ws: Ws, services: Services) -> dict:
        """The generation run's progress lines so far, so a canvas opened mid-run isn't blank."""
        return {"lines": services.skill_agents[kind].get_output(ws.id)}


def resolve_diagram(ws: Workspace, kind: str) -> dict:
    """One diagram kind's resolved payload, looked up in the registry at request time."""
    spec = DIAGRAMS.get(kind)
    # A route only ever registers a kind the registry can resolve, so a miss is a programming error.
    if spec is None:
        raise HTTPException(status_code=404, detail=f"unknown diagram kind: {kind!r}")
    if spec.sync_before_resolve:
        ws.sync()
    resolved = spec.resolve(ws)
    definition = get_definition(kind)
    overlays = definition.overlays if definition is not None else []
    if not overlays or not isinstance(resolved.get("nodes"), list):
        return resolved
    return attach_overlays(resolved, ws, overlays)


def diagram_path_response(ws: Workspace, kind: str, key_name: str | None = None) -> dict:
    """The `{kind}-path` body from the registry's spec; `key_name` renames the key (custom)."""
    spec = DIAGRAMS.get(kind)
    if spec is None:
        raise HTTPException(status_code=404, detail=f"unknown diagram kind: {kind!r}")
    path = ws.diagram_artifact_path(kind)
    return {"repo_root": str(ws.root), (key_name or f"{kind}_path"): str(path)}


def delete_diagram_artifact(ws: Workspace, kind: str) -> bool:
    """Deletes this repo's own diagram instance file; never a saved custom-type definition."""
    return delete_file_if_exists(ws.diagram_artifact_path(kind))


def _register_diagram_routes(spec: DiagramSpec) -> None:
    """Registers one diagram type's get/get-path(/generate/status/output)(/layout) routes."""
    kind = spec.kind
    # 016 Stage 6: patterns/impact dropped this trio -- no caller left once their views died.
    if spec.has_generate:
        _register_generate_routes(
            kind, spec.root_for, spec.supports_only_if_missing, spec.prompt_for
        )

    @router.get(f"/repos/{{repo_id}}/{kind}")
    def get_diagram(ws: Ws) -> dict:
        """One diagram type's resolved payload -- looked up in the registry at request time."""
        return resolve_diagram(ws, kind)

    @router.get(f"/repos/{{repo_id}}/{kind}-path")
    def get_diagram_path(ws: Ws) -> dict:
        """Absolute location the bridge reads this diagram from, for a client to write to."""
        return diagram_path_response(ws, kind)

    @router.delete(f"/repos/{{repo_id}}/{kind}")
    def delete_diagram(ws: Ws) -> dict:
        """Deletes this repo's own diagram instance file; the client strips the canvas layer."""
        return {"deleted": delete_diagram_artifact(ws, kind)}


def _register_layout_routes(kind: str) -> None:
    """One saved-layout GET/POST pair per kind -- diagrams and derived views share this shape."""

    @router.get(f"/repos/{{repo_id}}/{kind}/layout")
    def get_layout(ws: Ws) -> dict:
        """The user's saved box positions (drag offsets keyed by box id); {} when none."""
        return ws.layout_store(kind).load()

    @router.post(f"/repos/{{repo_id}}/{kind}/layout")
    async def save_layout(ws: Ws, request: Request) -> dict:
        """Persists the user's dragged box positions to disk (sanitized)."""
        return ws.layout_store(kind).save(await json_body(request))


for _spec in DIAGRAMS.values():
    _register_diagram_routes(_spec)

# Diagrams themselves moved layout to canvas.json (Stage 6); only the hierarchy still has one here.
_register_layout_routes("hierarchy")


# --- diagrams status: the "Add diagram" menu's readiness, so a click never silently no-ops ---


def _content_fingerprint(diagram: dict) -> str | None:
    """A stable hash of a diagram's raw JSON, for spotting an in-place edit; `None` if missing."""
    if not diagram:
        return None
    return hash_lines([json.dumps(diagram, sort_keys=True, default=str)])


@router.get("/repos/{repo_id}/diagrams/status")
def get_diagrams_status(ws: Ws, services: Services) -> dict:
    """Which diagram artifacts validate (`only_if_missing`'s check), plus a content fingerprint."""
    status: dict[str, object] = {
        kind: {
            "ready": services.skill_agents[kind].has_artifact(spec.root_for(ws), ws.id),
            "fingerprint": _content_fingerprint(ws.load_diagram(kind)),
        }
        for kind, spec in DIAGRAMS.items()
    }
    for entry in library.list_types():
        diagram = ws.load_diagram(f"custom/{entry['id']}")
        status[f"custom/{entry['id']}"] = {
            "ready": bool(diagram),
            "fingerprint": _content_fingerprint(diagram),
        }
    return status


# --- unified context envelope: replaces c1/coverage + patterns-context + impact-context (037) ---


def _patterns_staleness(ws: Workspace) -> dict:
    """Same signal `resolve_patterns_diagram` attaches -- live candidates vs. what was reviewed."""
    ws.sync()
    candidates = ws.engine.snapshot().pattern_candidates
    persisted = ws.load_diagram("patterns")
    raw_reviewed = persisted.get("fingerprint") if isinstance(persisted, dict) else None
    reviewed = raw_reviewed if isinstance(raw_reviewed, str) else None
    fingerprint = fingerprint_for(candidates)
    return attach_staleness({}, fingerprint=fingerprint, reviewed_fingerprint=reviewed)


# Only patterns opts into shared staleness here -- impact/custom already compute their own.
_STALENESS_PROVIDERS: dict[str, Callable[[Workspace], dict]] = {"patterns": _patterns_staleness}


def get_diagram_context(
    ws: Workspace, kind: str, *, source: str = "diff", feature: str | None = None
) -> dict:
    """The unified `{coverage, staleness, generation_data}` envelope for any kind, incl. custom."""
    definition = get_definition(kind)
    if definition is None:
        raise HTTPException(status_code=404, detail=f"unknown diagram kind: {kind!r}")
    coverage = None
    if definition.addons.get("coverage"):
        diagram = ws.load_diagram(kind)
        report = coverage_report(ws.engine, authored_paths(diagram))
        coverage = {"has_diagram": bool(diagram), **report}
    staleness = None
    if definition.addons.get("staleness"):
        staleness_fn = _STALENESS_PROVIDERS.get(kind)
        staleness = staleness_fn(ws) if staleness_fn else None
    generation_data = None
    if definition.context:
        context_provider = CONTEXT_PROVIDERS.get(definition.context)
        if context_provider:
            generation_data = context_provider.fetch(ws, source=source, feature=feature)
    return {"coverage": coverage, "staleness": staleness, "generation_data": generation_data}


@router.get("/repos/{repo_id}/{kind}/context")
def get_diagram_context_route(
    kind: str, ws: Ws, source: str = "diff", feature: str | None = None
) -> dict:
    """Every built-in type's context envelope -- custom types register their own path below."""
    return get_diagram_context(ws, kind, source=source, feature=feature)


# --- the unified review flow: one ReviewResult shape for any type with a review axis (037, US3) ---


@router.get("/repos/{repo_id}/{kind}/review")
def get_diagram_review_route(kind: str, ws: Ws) -> dict:
    """The shared explanatory/judgmental review payload -- see contracts/review-result.md."""
    result = resolve_review(ws, kind)
    if result is None:
        raise HTTPException(status_code=404, detail=f"{kind!r} has no review flow")
    return result


# --- the Impact change review: the same runner, a payload the generic GET has no room for ---


def _pr_comments(services: BridgeServices, repo_id: str) -> tuple[list[dict], list[dict]]:
    """A PR workspace's fetched (review, general) comments; empty for every other workspace."""
    record = services.pr_manager.find_by_id(repo_id)
    return (record.review_comments, record.general_comments) if record else ([], [])


def _resolved_review(services: BridgeServices, repo_id: str, ws: Workspace) -> dict:
    review_comments, general_comments = _pr_comments(services, repo_id)
    return resolve_impact_changes(
        ws.root,
        ws.load_diagram("impact"),
        ws.load_impact_changes(),
        base=ws.diff_base(),
        review_comments=review_comments,
        general_comments=general_comments,
        engine=ws.engine,
    )


@router.get("/repos/{repo_id}/impact-changes")
def get_impact_changes(repo_id: str, ws: Ws, services: Services) -> dict:
    """What the current git diff does to each Impact box — badges from git, prose if reviewed."""
    ws.sync()
    return _resolved_review(services, repo_id, ws)


@router.get("/repos/{repo_id}/impact-changes-path")
def get_impact_changes_path(repo_id: str, ws: Ws, services: Services) -> dict:
    """Where to write the review, plus the fingerprint of the diff it must declare it reviewed."""
    resolved = _resolved_review(services, repo_id, ws)
    return {
        "repo_root": str(ws.root),
        "impact_changes_path": str(ws.impact_changes_path),
        "fingerprint": resolved["fingerprint"],
    }


# No only_if_missing; mirrors services._build_skill_agents so a second review agent wires for free.
_registered_review_factories: set[str] = set()
for _definition in (BUILTIN_TYPES[_kind] for _kind in BUILTIN_TYPES):
    if _definition.review is None:
        continue
    _factory_name = _definition.review.agent_factory
    _known = _factory_name in REVIEW_AGENT_FACTORIES
    _unseen = _factory_name not in _registered_review_factories
    if _known and _unseen:
        _register_generate_routes(_factory_name, lambda ws: ws.root, supports_only_if_missing=False)
        _registered_review_factories.add(_factory_name)




# --- wiki context: the wiki-page bundle a diagram-drawing skill reads instead of a raw dump ---


@router.get("/repos/{repo_id}/wiki-context")
def get_wiki_context(ws: Ws, paths: str = "") -> dict:
    """A wiki-backed bundle for the requested paths, freshly synced; {has_wiki:false} with none."""
    wiki_dir = ws.root / ".codechroma" / "wiki"
    if not (wiki_dir / "index.md").is_file():
        return asdict(WikiContextBundle(has_wiki=False, root=None))
    try:
        ws.engine.sync_wiki(wiki_dir)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"wiki sync failed: {exc}") from exc
    requested = [p for p in paths.split(",") if p]
    return asdict(build_wiki_context(wiki_dir, requested))


# --- wiki-general context: the compact root+containers bundle 049 has diagram skills read first ---


@router.get("/repos/{repo_id}/wiki-general-context")
def get_wiki_general_context(ws: Ws) -> dict:
    """Root overview plus every container page; {has_wiki_general:false} with none."""
    return asdict(build_wiki_general_context(wiki_general_dir(ws.root, ws.id)))
