"""In-app "Create issue": reports whether `gh` can post, and posts through it when it can."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from codechroma.bridge.agents.publish import first_url, run_gh
from codechroma.bridge.routes._body import json_body
from codechroma.llm.runtime_env import cli_available

router = APIRouter()

ISSUE_REPO = "gutzerk/code_chroma"
_ALLOWED_LABELS = {"bug", "enhancement", "question", "documentation"}


_READY_TTL_SECONDS = 60.0
_ready_cache: tuple[float, bool] | None = None


def _gh_ready() -> bool:
    """Whether `gh` is installed and logged in; the auth probe hits the network, so it is cached."""
    global _ready_cache
    now = time.monotonic()
    if _ready_cache is not None and now - _ready_cache[0] < _READY_TTL_SECONDS:
        return _ready_cache[1]
    ready = cli_available("gh") and run_gh(Path.home(), "auth", "status", quiet=True) is not None
    _ready_cache = (now, ready)
    return ready


@router.get("/issues/status")
async def issue_status() -> dict:
    return {"repo": ISSUE_REPO, "can_post": await asyncio.to_thread(_gh_ready)}


@router.post("/issues")
async def create_issue(request: Request) -> dict:
    payload = await json_body(request)
    title = str(payload.get("title", "")).strip()
    label = str(payload.get("label", "bug"))
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    if label not in _ALLOWED_LABELS:
        raise HTTPException(status_code=400, detail=f"unknown label: {label}")
    if not await asyncio.to_thread(_gh_ready):
        raise HTTPException(status_code=409, detail="GitHub CLI is missing or not logged in")
    output = await asyncio.to_thread(
        run_gh,
        Path.home(),
        "issue",
        "create",
        "--repo",
        ISSUE_REPO,
        "--title",
        title,
        "--body",
        str(payload.get("body", "")),
        "--label",
        label,
    )
    url = first_url(output or "")
    if url is None:
        raise HTTPException(status_code=502, detail="gh issue create failed (see the bridge log)")
    return {"url": url}
