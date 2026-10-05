"""Global executable overrides, safe diagnostics, re-detection, and focus rechecks."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request

from codechroma.bridge.routes._body import json_body
from codechroma.llm.runtime_env import get_runtime_environment
from codechroma.llm.runtime_settings import load_runtime_settings, save_runtime_settings

router = APIRouter()


@router.get("/runtime/settings")
def runtime_settings() -> dict:
    return load_runtime_settings().payload()


@router.put("/runtime/settings")
async def put_runtime_settings(request: Request) -> dict:
    payload = await json_body(request)
    try:
        settings = save_runtime_settings(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await asyncio.to_thread(lambda: get_runtime_environment().configure(settings).result())
    return settings.payload()


@router.get("/runtime/environment")
def environment_diagnostics() -> dict:
    return get_runtime_environment().snapshot().diagnostics()


@router.get("/runtime/cli/{name}")
def cli_diagnostics(name: str) -> dict:
    return get_runtime_environment().diagnose(name)


@router.post("/runtime/refresh")
async def redetect_environment() -> dict:
    snapshot = await asyncio.to_thread(
        lambda: get_runtime_environment().refresh("user Re-detect", force=True).result(),
    )
    return snapshot.diagnostics()


@router.post("/runtime/focus")
async def recheck_after_focus() -> dict:
    snapshot = await asyncio.to_thread(get_runtime_environment().recheck_unresolved)
    return snapshot.diagnostics()
