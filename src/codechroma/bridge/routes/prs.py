"""Pull requests as read-only workspaces: fetch one into a worktree, refresh it, close it."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from codechroma.bridge.agents.publish import (
    BUTTON_TEXT as _PUBLISH_BUTTON_TEXT,
)
from codechroma.bridge.agents.publish import (
    REASON_GH_MISSING as PR_REASON_GH_MISSING,
)
from codechroma.bridge.agents.publish import (
    REASON_NOT_AUTHENTICATED as PR_REASON_NOT_AUTHENTICATED,
)
from codechroma.bridge.agents.publish import (
    REASON_NOT_GITHUB as PR_REASON_NOT_GITHUB,
)
from codechroma.bridge.agents.worktree import WorktreeError
from codechroma.bridge.deps import Services
from codechroma.bridge.pr_import_seed import seed_diagrams_from_main
from codechroma.bridge.prs import github as pr_github
from codechroma.bridge.prs import importer as pr_importer
from codechroma.bridge.prs.github import PrReference
from codechroma.bridge.prs.manager import (
    PrLimitError,
    PrRecord,
    UnknownPrError,
    max_pr_workspaces,
)
from codechroma.bridge.routes._body import as_count, json_body
from codechroma.bridge.services import BridgeServices
from codechroma.bridge.workspaces import MAIN_ID

router = APIRouter()

PR_REASON_LIMIT = "limit-reached"
PR_REASON_INVALID_REF = "invalid-ref"
PR_REASON_WRONG_REPO = "wrong-repo"

# The three GitHub-CLI blockers' text is shared with publish's own button; the rest is PR-specific.
PR_BUTTON_TEXT = {
    PR_REASON_GH_MISSING: _PUBLISH_BUTTON_TEXT[PR_REASON_GH_MISSING],
    PR_REASON_NOT_AUTHENTICATED: _PUBLISH_BUTTON_TEXT[PR_REASON_NOT_AUTHENTICATED],
    PR_REASON_NOT_GITHUB: _PUBLISH_BUTTON_TEXT[PR_REASON_NOT_GITHUB],
    PR_REASON_LIMIT: f"The limit of {max_pr_workspaces()} open PR reviews is reached",
    PR_REASON_INVALID_REF: "Paste a GitHub pull-request URL, or a number like #123",
    PR_REASON_WRONG_REPO: "That pull request is in another repository",
}


@router.get("/prs/preflight")
def get_pr_import_preflight(services: Services) -> dict:
    """Everything that would stop a PR being opened, checked before the button renders."""
    reason = _pr_blocker(services)
    return {
        "ready": reason is None,
        "reason": reason,
        "text": PR_BUTTON_TEXT.get(reason or ""),
        "origin": _origin_payload(services),
        "count": len(services.pr_manager.list()),
        "max_prs": max_pr_workspaces(),
    }


@router.get("/prs")
def list_prs(services: Services) -> dict:
    """Every open pull-request review, plus which workspace the canvas is currently drawing."""
    return {
        "prs": [record.to_payload() for record in services.pr_manager.list()],
        "max_prs": max_pr_workspaces(),
        "active_workspace": services.agent_manager.active_workspace,
    }


@router.get("/prs/github")
def list_github_prs(services: Services) -> dict:
    """Every open pull request on GitHub, for the picker -- skips `_pr_blocker`'s slow auth check"""
    if not pr_github.has_gh():
        raise HTTPException(status_code=409, detail=PR_BUTTON_TEXT[PR_REASON_GH_MISSING])
    if not pr_github.is_github_remote(services.repo_root):
        raise HTTPException(status_code=409, detail=PR_BUTTON_TEXT[PR_REASON_NOT_GITHUB])
    prs = pr_github.list_open_prs(services.repo_root)
    if prs is None:
        raise HTTPException(status_code=502, detail="gh pr list failed")
    return {"prs": prs}


@router.post("/prs")
async def open_pr(request: Request, services: Services) -> dict:
    """Fetches the pull request `ref` names into a read-only workspace and registers it."""
    reference = pr_github.parse_pr_reference((await json_body(request)).get("ref"))
    if reference is None:
        raise HTTPException(status_code=400, detail=PR_BUTTON_TEXT[PR_REASON_INVALID_REF])
    # Already open: link to it rather than fetching twice, as the publish button already does.
    existing = services.pr_manager.find(reference.number)
    if existing is not None:
        return existing.to_payload()
    record = await asyncio.to_thread(_open_pr_blocking, services, reference)
    await services.connections.broadcast({"type": "pr-added", "pr": record.to_payload()})
    return record.to_payload()


def _open_pr_blocking(services: BridgeServices, reference: PrReference) -> PrRecord:
    """Every `gh`/`git` call opening a PR, in one place so the caller offloads it off the loop."""
    blocker = _pr_blocker(services)
    if blocker is not None:
        raise HTTPException(status_code=409, detail=PR_BUTTON_TEXT[blocker])
    if not pr_github.belongs_to_origin(reference, services.repo_root):
        raise HTTPException(status_code=400, detail=PR_BUTTON_TEXT[PR_REASON_WRONG_REPO])
    metadata = pr_github.fetch_metadata(services.repo_root, reference.number)
    if metadata is None:
        raise HTTPException(status_code=404, detail=f"no pull request #{reference.number} here")
    return _import_pr_record(services, reference.number, metadata)


@router.post("/prs/{number}/refresh")
async def refresh_pr(number: int, services: Services) -> dict:
    """Re-fetches the pull request; moves its worktree and reanalyzes only if the head moved."""
    record = _pr_or_404(services, number)
    _guard_no_attached_agents(services, record)
    previous = record.head_sha
    updated, moved = await asyncio.to_thread(_refresh_pr_blocking, services, number, record)
    services.pr_manager.upsert(updated)
    if moved:
        # Unloaded, not reanalyzed in place: the next request re-seeds from main's parse.
        await asyncio.to_thread(services.registry.drop_live, updated.id)
    await services.connections.broadcast({"type": "pr-updated", "pr": updated.to_payload()})
    # useImpactChangesSidecar only refetches /impact-changes on "changed", never on "pr-updated".
    await services.connections.broadcast(
        {"type": "changed", "paths": [], "workspace": updated.id}
    )
    return {**updated.to_payload(), "updated": moved, "previous_head_sha": previous}


@router.delete("/prs/{number}")
async def close_pr(number: int, services: Services) -> dict:
    """Drops the worktree, both fetched refs and the registration; the canvas returns to main."""
    record = _pr_or_404(services, number)
    _guard_no_attached_agents(services, record)
    # Both offloaded: drop_live joins a running analyze thread, and remove_pr shells out to git.
    await asyncio.to_thread(_close_pr_blocking, services, number, record)
    services.pr_manager.delete(number)
    # unregister ends in drop_live, which joins a bring-up thread; keep it off the loop too.
    await asyncio.to_thread(services.registry.unregister, record.id)
    await services.forget_workspace_runs(record.id)
    if services.agent_manager.active_workspace == record.id:
        services.agent_manager.set_active_workspace(MAIN_ID)
    await services.connections.broadcast({"type": "pr-removed", "id": record.id})
    return {"status": "deleted", "id": record.id}


def _close_pr_blocking(services: BridgeServices, number: int, record: PrRecord) -> None:
    """Unloads before the directory goes: an analyze still writing graph.db would fail mid-write."""
    services.registry.drop_live(record.id)
    # A WorktreeError becomes a 409 via the table in bridge/errors.py.
    pr_importer.remove_pr(services.repo_root, number, Path(record.worktree))


def _refresh_pr_blocking(
    services: BridgeServices, number: int, record: PrRecord
) -> tuple[PrRecord, bool]:
    """The `git fetch` + `gh` half of a refresh, in one place so the caller can offload it."""
    # GitLongError and WorktreeError both become 409s via the table in bridge/errors.py.
    sha, moved = pr_importer.refresh_pr(
        services.repo_root, number, Path(record.worktree), record.base_ref, record.head_sha
    )
    metadata = pr_github.fetch_metadata(services.repo_root, number)
    updated = _pr_record(
        services, number, metadata, record.worktree, sha, imported_at=record.imported_at
    )
    return updated, moved


def _pr_blocker(services: BridgeServices) -> str | None:
    """The first thing stopping a pull request from opening, in the publish preflight's order."""
    if not pr_github.has_gh():
        return PR_REASON_GH_MISSING
    if not pr_github.is_authenticated(services.repo_root):
        return PR_REASON_NOT_AUTHENTICATED
    if not pr_github.is_github_remote(services.repo_root):
        return PR_REASON_NOT_GITHUB
    if services.pr_manager.at_capacity():
        return PR_REASON_LIMIT
    return None


def _origin_payload(services: BridgeServices) -> dict | None:
    slug = pr_github.origin_slug(services.repo_root)
    return {"owner": slug[0], "repo": slug[1]} if slug else None


def _pr_or_404(services: BridgeServices, number: int) -> PrRecord:
    try:
        return services.pr_manager.get(number)
    except UnknownPrError as exc:
        raise HTTPException(status_code=404, detail=f"no open review for #{number}") from exc


def _guard_no_attached_agents(services: BridgeServices, record: PrRecord) -> None:
    """Refuses to move/remove a PR's worktree while an agent is still attached reviewing it."""
    attached = services.agent_manager.attached_to_pr(record.id)
    if attached:
        names = ", ".join(agent.id for agent in attached)
        raise WorktreeError(f"{record.id} is still in use by agent(s) {names}")


def _import_pr_record(services: BridgeServices, number: int, metadata: dict) -> PrRecord:
    """Fetches and registers one pull request, turning each failure into its own status code."""
    base_ref = str(metadata.get("baseRefName") or "")
    if not base_ref:
        raise HTTPException(status_code=409, detail=f"#{number} names no base branch")
    # GitLongError and WorktreeError both become 409s via the table in bridge/errors.py.
    path, sha = pr_importer.import_pr(services.repo_root, number, base_ref)
    # Bare checkout -> give it main's authored diagrams so the canvas isn't "you don't have any".
    seed_diagrams_from_main(path, services.registry.main.root)
    record = _pr_record(services, number, metadata, str(path), sha)
    try:
        services.pr_manager.upsert(record)
    except PrLimitError as exc:
        pr_importer.remove_pr(services.repo_root, number, path)
        raise HTTPException(status_code=409, detail=PR_BUTTON_TEXT[PR_REASON_LIMIT]) from exc
    services.registry.register(
        record.id,
        Path(record.worktree),
        base_ref=pr_importer.local_base_ref(number),
        read_only=True,
        c1_source_root=services.registry.main.root,
    )
    return record


def _pr_record(
    services: BridgeServices,
    number: int,
    metadata: dict | None,
    worktree_path: str,
    sha: str,
    imported_at: str | None = None,
) -> PrRecord:
    """One record from gh's metadata; a failed metadata read keeps the fetch, minus the labels."""
    data = metadata or {}
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    return PrRecord(
        number=number,
        title=str(data.get("title") or f"#{number}"),
        url=str(data.get("url") or ""),
        head_ref=str(data.get("headRefName") or ""),
        head_sha=sha,
        base_ref=str(data.get("baseRefName") or ""),
        worktree=worktree_path,
        imported_at=imported_at or now,
        fetched_at=now,
        author=pr_github.author_login(data),
        state=str(data.get("state") or ""),
        head_repo=pr_github.head_owner(data),
        is_fork=bool(data.get("isCrossRepository")),
        changed_files=as_count(data.get("changedFiles")),
        additions=as_count(data.get("additions")),
        deletions=as_count(data.get("deletions")),
        review_comments=pr_github.fetch_review_comments(services.repo_root, number),
        general_comments=pr_github.fetch_general_comments(services.repo_root, number),
    )
