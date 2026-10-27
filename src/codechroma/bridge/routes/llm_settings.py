"""LLM provider/call-site routes: `/llm/providers`, `/llm/call-sites`.

Not repo-scoped -- same as `routes/assistant.py`, no `Services` dependency, since providers and
assignments are machine-local, not per-repo. Full contract in
`specs/034-llm-provider-settings/contracts/llm-settings-routes.md`.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request

from codechroma.assistant import load_assistant_settings
from codechroma.bridge.routes._body import json_body
from codechroma.context.llm_provider import probe_model_for, provider_to_llm
from codechroma.llm import model_catalog, providers_store
from codechroma.llm.call_site_settings import (
    GroupAssignment,
    blocking_call_sites,
    clear_assignment,
    clear_default,
    clear_group_assignment,
    load_assignments,
    load_default,
    load_group_assignments,
    resolve_default,
    save_assignment,
    save_default,
    save_group_assignment,
    save_offline_assignment,
)
from codechroma.llm.call_sites import CALL_SITES, FEATURES, GROUPS, HIDDEN_GROUPS
from codechroma.llm.cli_auth import cli_signed_in
from codechroma.llm.runtime_env import CliLookupError, resolve_runtime_cli

router = APIRouter()


@router.get("/llm/providers")
def list_providers() -> list[dict]:
    used = [row["effective"]["provider_id"] for row in _feature_rows()]
    return [
        {**provider.masked(), **_capability_fields(provider, used.count(provider.id))}
        for provider in providers_store.load_providers().values()
    ]


def _capability_fields(provider: providers_store.Provider, used_by: int) -> dict:
    caps = providers_store.capabilities(provider)
    return {"capabilities": {"agents": caps.agents, "quick": caps.quick}, "used_by": used_by}


@router.post("/llm/providers", status_code=201)
async def create_provider(request: Request) -> dict:
    body = await json_body(request)
    try:
        created = providers_store.create_provider(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return created.masked()


@router.put("/llm/providers/{provider_id}")
async def update_provider(provider_id: str, request: Request) -> dict:
    body = await json_body(request)
    try:
        updated = providers_store.update_provider(provider_id, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if updated is None:
        raise HTTPException(status_code=404, detail=f"unknown provider: {provider_id!r}")
    return updated.masked()


@router.delete("/llm/providers/{provider_id}", status_code=204)
def delete_provider(provider_id: str) -> None:
    if providers_store.find_provider(provider_id) is None:
        raise HTTPException(status_code=404, detail=f"unknown provider: {provider_id!r}")
    blocking = blocking_call_sites(provider_id)
    if blocking:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "provider is still assigned to one or more call sites",
                "blocking_call_sites": blocking,
            },
        )
    providers_store.delete_provider(provider_id)


@router.post("/llm/providers/capabilities")
async def draft_capabilities(request: Request) -> dict:
    """What a not-yet-saved form draft could be used for -- the Add/Edit form's preview line."""
    body = await json_body(request)
    if body.get("api_key_set") and not body.get("api_key"):
        body = {**body, "api_key": "<kept>"}
    caps = providers_store.capabilities(providers_store.draft_from_payload(body))
    return {"capabilities": {"agents": caps.agents, "quick": caps.quick}}


@router.post("/llm/providers/test")
async def test_provider_draft(request: Request) -> dict:
    """Tests a not-yet-saved provider (the Add/Edit form's own Test button) -- no id, no write."""
    body = await json_body(request)
    problems = providers_store.validate(body)
    if problems:
        raise HTTPException(status_code=400, detail="; ".join(problems))
    draft = providers_store.draft_from_payload(body)
    # Offload the blocking network call so it doesn't stall the event loop (same as elsewhere).
    return await asyncio.to_thread(_run_provider_test, None, draft)


@router.post("/llm/providers/{provider_id}/test")
def test_provider(provider_id: str) -> dict:
    provider = providers_store.find_provider(provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail=f"unknown provider: {provider_id!r}")
    return _run_provider_test(provider_id, provider)


@router.get("/llm/cli/{adapter}/auth")
async def get_cli_auth(adapter: str) -> dict:
    """Whether that CLI reports a signed-in account; `signed_in` is null when it can't be told."""
    return {"signed_in": await asyncio.to_thread(cli_signed_in, adapter)}


@router.get("/llm/providers/{provider_id}/models")
async def get_provider_models(provider_id: str) -> dict:
    """A provider model catalog, queried live else a built-in list."""
    provider = providers_store.find_provider(provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail=f"unknown provider: {provider_id!r}")
    return await asyncio.to_thread(model_catalog.fetch_models, provider)


def _run_provider_test(provider_id: str | None, provider: providers_store.Provider) -> dict:
    if provider.kind == "cli":
        try:
            resolve_runtime_cli(provider.adapter or "")
        except CliLookupError as exc:
            error = str(exc)
            return {"ok": False, "provider_id": provider_id, "error": error}
        result = model_catalog.fetch_models(provider)
        if result["error"]:
            return {"ok": False, "provider_id": provider_id, "error": result["error"]}
        reply = {"ok": True, "provider_id": provider_id, "message": "ok"}
        if not result.get("static") and result["models"]:
            reply["models_count"] = len(result["models"])
        return reply
    return _test_api_provider(provider_id, provider)


def _test_api_provider(provider_id: str | None, provider: providers_store.Provider) -> dict:
    llm = provider_to_llm(provider)
    if llm is None:
        error = "provider is not fully configured"
        return {"ok": False, "provider_id": provider_id, "error": error}
    model = probe_model_for(provider.transport) or provider.test_model
    if not model:
        error = "set a test model for this provider before testing"
        return {"ok": False, "provider_id": provider_id, "error": error}
    try:
        text = llm.complete(user="Reply with the single word: ok", model=model, max_tokens=1)
    except Exception as exc:
        return {"ok": False, "provider_id": provider_id, "error": str(exc)}
    reply = {"ok": True, "provider_id": provider_id, "message": text[:40]}
    listing = model_catalog.fetch_models(provider)
    if not listing["error"] and not listing.get("static") and listing["models"]:
        reply["models_count"] = len(listing["models"])
    return reply


@router.get("/llm/default")
def get_default() -> dict:
    return {"default": _default_dict()}


@router.put("/llm/default")
async def put_default(request: Request) -> dict:
    body = await json_body(request)
    await _fill_default_models(body)
    try:
        save_default(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"default": _default_dict()}


@router.delete("/llm/default")
def delete_default() -> dict:
    clear_default()
    return {"default": None}


@router.get("/llm/features")
def list_features() -> dict:
    return {"features": _feature_rows()}


@router.put("/llm/features/{feature_id}")
async def put_feature(feature_id: str, request: Request) -> dict:
    """Overrides one feature: a group assignment or a simple call-site one, picked server-side."""
    if feature_id not in FEATURES:
        raise HTTPException(status_code=404, detail=f"unknown feature: {feature_id!r}")
    body = await json_body(request)
    if body.get("offline") is True:
        try:
            save_offline_assignment(feature_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return _feature_row(feature_id)
    payload = {"provider_id": body.get("provider_id"), "model": body.get("model")}
    if _blank(payload["model"]):
        current = _feature_row(feature_id)["effective"]
        keep = current["model"] if current["provider_id"] == payload["provider_id"] else None
        payload["model"] = await _pick_model(payload["provider_id"], keep)
    try:
        if feature_id in GROUPS:
            save_group_assignment(feature_id, payload)
        else:
            save_assignment(feature_id, {**payload, "mode": "api"})
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _feature_row(feature_id)


def _blank(model: object) -> bool:
    return not isinstance(model, str) or not model.strip()


async def _pick_model(provider_id: object, current: str | None, *, first: bool = False) -> str:
    """Keeps `current` if listed, else the second (or `first`) model; "" lets validation refuse."""
    provider = providers_store.find_provider(provider_id) if isinstance(provider_id, str) else None
    if provider is None:
        return ""
    result = await asyncio.to_thread(model_catalog.fetch_models, provider)
    ids = [m["id"] for m in result.get("models") or []]
    if current and current in ids:
        return current
    if not ids:
        return ""
    return ids[0] if first or len(ids) == 1 else ids[1]


async def _fill_default_models(body: dict) -> None:
    """Picks server-side any blank model on the default and its provider fallbacks."""
    if not isinstance(body, dict):
        return
    if _blank(body.get("model")):
        stored = load_default()
        same = stored is not None and stored.provider_id == body.get("provider_id")
        body["model"] = await _pick_model(body.get("provider_id"), stored.model if same else None)
    for key in ("quick_fallback", "agent_fallback"):
        fallback = body.get(key)
        needs_model = isinstance(fallback, dict) and not fallback.get("offline")
        if needs_model and _blank(fallback.get("model")):
            fallback["model"] = await _pick_model(fallback.get("provider_id"), None, first=True)


@router.delete("/llm/features/{feature_id}")
def delete_feature(feature_id: str) -> dict:
    """Drops a feature's override so it follows the default again."""
    if feature_id not in FEATURES:
        raise HTTPException(status_code=404, detail=f"unknown feature: {feature_id!r}")
    if feature_id in GROUPS:
        clear_group_assignment(feature_id)
    else:
        clear_assignment(feature_id)
    return _feature_row(feature_id)


def _feature_row(feature_id: str) -> dict:
    return next(row for row in _feature_rows() if row["id"] == feature_id)


def _default_dict() -> dict | None:
    default = load_default()
    if default is None:
        return None

    def fallback(raw) -> dict | None:
        if raw is None:
            return None
        if raw.offline:
            return {"offline": True}
        return {"provider_id": raw.provider_id, "model": raw.model}

    return {
        "provider_id": default.provider_id,
        "model": default.model,
        "quick_fallback": fallback(default.quick_fallback),
        "agent_fallback": fallback(default.agent_fallback),
    }


def _feature_rows() -> list[dict]:
    providers = providers_store.load_providers()
    assignments = load_assignments()
    group_assignments = load_group_assignments()
    rows = []
    for feature in FEATURES.values():
        override = (
            group_assignments.get(feature.id)
            if feature.id in GROUPS
            else assignments.get(feature.id)
        )
        if override is not None:
            provider_id, model, source = override.provider_id, override.model, "custom"
            if getattr(override, "mode", None) == "offline":
                source = "offline"
        else:
            resolved, source = resolve_default(feature.needs)
            provider_id = resolved.provider_id if resolved is not None else None
            model = resolved.model if resolved is not None else None
        provider = providers.get(provider_id) if provider_id else None
        rows.append(
            {
                "id": feature.id,
                "label": feature.label,
                "description": feature.description,
                "needs": feature.needs,
                "effective": {
                    "provider_id": provider_id or None,
                    "provider_name": provider.label if provider is not None else None,
                    "model": model or None,
                },
                "source": source,
                "compatible_provider_ids": [
                    pid
                    for pid, candidate in providers.items()
                    if getattr(providers_store.capabilities(candidate), feature.needs)
                ],
            }
        )
    return rows


@router.get("/llm/call-sites")
def list_call_sites() -> dict:
    assignments = load_assignments()
    group_assignments = load_group_assignments()
    providers = providers_store.load_providers()
    default_cli = load_assistant_settings().effective_cli
    simple = [
        _joined_call_site(site_id, assignments.get(site_id))
        for site_id, site in CALL_SITES.items()
        if site.capability == "simple"
    ]
    groups = [
        _joined_group(group_id, group_assignments.get(group_id), providers, default_cli)
        for group_id in GROUPS
        if group_id not in HIDDEN_GROUPS
    ]
    return {"simple": simple, "groups": groups}


@router.put("/llm/call-sites/{call_site_id}")
async def put_call_site(call_site_id: str, request: Request) -> dict:
    if call_site_id not in CALL_SITES:
        raise HTTPException(status_code=404, detail=f"unknown call site: {call_site_id!r}")
    if CALL_SITES[call_site_id].capability == "agentic":
        raise HTTPException(
            status_code=400,
            detail=(
                f"{call_site_id!r} is agentic; assign its group via "
                "PUT /llm/call-site-groups/{group_id} instead"
            ),
        )
    body = await json_body(request)
    if not body or not body.get("provider_id"):
        clear_assignment(call_site_id)
        return _joined_call_site(call_site_id, None)
    try:
        assignment = save_assignment(call_site_id, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _joined_call_site(call_site_id, assignment)


@router.get("/llm/call-site-groups/{group_id}")
def get_call_site_group(group_id: str) -> dict:
    """One group (incl. tab-hidden `agents`) by id -- the "Agent windows" tab reads its provider."""

    if group_id not in GROUPS:
        raise HTTPException(status_code=404, detail=f"unknown call site group: {group_id!r}")
    providers = providers_store.load_providers()
    default_cli = load_assistant_settings().effective_cli
    return _joined_group(
        group_id, load_group_assignments().get(group_id), providers, default_cli
    )


@router.put("/llm/call-site-groups/{group_id}")
async def put_call_site_group(group_id: str, request: Request) -> dict:
    if group_id not in GROUPS:
        raise HTTPException(status_code=404, detail=f"unknown call site group: {group_id!r}")
    body = await json_body(request)
    providers = providers_store.load_providers()
    default_cli = load_assistant_settings().effective_cli
    if not body or not body.get("provider_id"):
        clear_group_assignment(group_id)
        return _joined_group(group_id, None, providers, default_cli)
    try:
        group_assignment = save_group_assignment(group_id, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _joined_group(group_id, group_assignment, providers, default_cli)


def _joined_call_site(call_site_id: str, assignment) -> dict:
    call_site = CALL_SITES[call_site_id]
    return {
        "id": call_site.id,
        "label": call_site.label,
        "capability": call_site.capability,
        "description": call_site.description,
        "assignment": None
        if assignment is None
        else {
            "provider_id": assignment.provider_id,
            "model": assignment.model,
            "mode": assignment.mode,
        },
    }


def _group_cli_available(
    group_assignment: GroupAssignment | None,
    providers: dict[str, providers_store.Provider],
    default_cli: str | None,
) -> bool:
    """Whether the group's effective CLI is on PATH -- unassigned still falls back to `claude`."""
    if group_assignment is not None:
        provider = providers.get(group_assignment.provider_id)
        binary = provider.adapter if provider is not None else None
    else:
        binary = default_cli
    if not binary:
        return False
    try:
        resolve_runtime_cli(binary)
        return True
    except CliLookupError:
        return False


def _joined_group(
    group_id: str,
    group_assignment: GroupAssignment | None,
    providers: dict[str, providers_store.Provider],
    default_cli: str | None,
) -> dict:
    group = GROUPS[group_id]
    return {
        "id": group.id,
        "label": group.label,
        "members": [
            {
                "id": CALL_SITES[member].id,
                "label": CALL_SITES[member].label,
                "description": CALL_SITES[member].description,
            }
            for member in group.members
        ],
        "assignment": None
        if group_assignment is None
        else {"provider_id": group_assignment.provider_id, "model": group_assignment.model},
        "cli_available": _group_cli_available(group_assignment, providers, default_cli),
    }


__all__ = ["router"]
