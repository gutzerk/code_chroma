"""LLM provider/call-site routes: `/llm/providers`, `/llm/call-sites`.

Not repo-scoped -- same as `routes/assistant.py`, no `Services` dependency, since providers and
assignments are machine-local, not per-repo. Full contract in
`specs/034-llm-provider-settings/contracts/llm-settings-routes.md`.
"""

from __future__ import annotations

import asyncio
import shutil

from fastapi import APIRouter, HTTPException, Request

from codechroma.assistant import load_assistant_settings
from codechroma.bridge.routes._body import json_body
from codechroma.context.llm_provider import PROBE_MODEL, provider_to_llm
from codechroma.llm import model_catalog, providers_store
from codechroma.llm.call_site_settings import (
    GroupAssignment,
    blocking_call_sites,
    clear_assignment,
    clear_group_assignment,
    load_assignments,
    load_group_assignments,
    save_assignment,
    save_group_assignment,
)
from codechroma.llm.call_sites import CALL_SITES, GROUPS, HIDDEN_GROUPS

router = APIRouter()


@router.get("/llm/providers")
def list_providers() -> list[dict]:
    return [provider.masked() for provider in providers_store.load_providers().values()]


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


@router.get("/llm/providers/{provider_id}/models")
async def get_provider_models(provider_id: str) -> dict:
    """A provider's own model catalog, queried live -- feeds the Model routing "Fetch models"."""
    provider = providers_store.find_provider(provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail=f"unknown provider: {provider_id!r}")
    return await asyncio.to_thread(model_catalog.fetch_models, provider)


def _run_provider_test(provider_id: str | None, provider: providers_store.Provider) -> dict:
    if provider.kind == "cli":
        found = shutil.which(provider.adapter or "") is not None
        if not found:
            error = f"{provider.adapter!r} not found on PATH"
            return {"ok": False, "provider_id": provider_id, "error": error}
        result = model_catalog.fetch_models(provider)
        if result["error"]:
            return {"ok": False, "provider_id": provider_id, "error": result["error"]}
        return {"ok": True, "provider_id": provider_id, "message": "ok"}
    return _test_api_provider(provider_id, provider)


def _test_api_provider(provider_id: str | None, provider: providers_store.Provider) -> dict:
    llm = provider_to_llm(provider)
    if llm is None:
        error = "provider is not fully configured"
        return {"ok": False, "provider_id": provider_id, "error": error}
    if provider.transport == "anthropic":
        model = PROBE_MODEL
    elif provider.test_model:
        model = provider.test_model
    else:
        error = "set a test model for this provider before testing"
        return {"ok": False, "provider_id": provider_id, "error": error}
    try:
        text = llm.complete(user="Reply with the single word: ok", model=model, max_tokens=1)
    except Exception as exc:
        return {"ok": False, "provider_id": provider_id, "error": str(exc)}
    return {"ok": True, "provider_id": provider_id, "message": text[:40]}


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
    return bool(binary and shutil.which(binary))


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
