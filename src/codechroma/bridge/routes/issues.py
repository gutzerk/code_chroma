"""In-app "Create issue": reports whether `gh` can post, and posts through it when it can."""

from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from codechroma.bridge.agents.publish import first_url, run_gh
from codechroma.bridge.routes._body import json_body
from codechroma.llm.runtime_env import cli_available

router = APIRouter()

ISSUE_REPO = "gutzerk/code_chroma"
_ALLOWED_LABELS = {"bug", "enhancement", "question", "documentation"}


def _gh_ready() -> bool:
    return cli_available("gh") and run_gh(Path.home(), "auth", "status") is not None


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
        run_gh, Path.home(), "issue", "create", "--repo", ISSUE_REPO,
        "--title", title, "--body", str(payload.get("body", "")), "--label", label,
    )
    url = first_url(output or "")
    if url is None:
        raise HTTPException(status_code=502, detail="gh issue create failed")
    return {"url": url}
