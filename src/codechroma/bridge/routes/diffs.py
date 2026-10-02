"""The Diff toggle's two layers: per-function diffs, change cards, and committing one node."""

from __future__ import annotations

from fastapi import APIRouter

from codechroma.bridge import git_accept
from codechroma.bridge.change_cards import build_change_cards
from codechroma.bridge.deps import WritableWs, Ws
from codechroma.bridge.git_diff import compute_function_diffs

router = APIRouter()


@router.get("/repos/{repo_id}/diff")
def get_diff(ws: Ws) -> list[dict]:
    ws.sync()
    return compute_function_diffs(ws.engine, ws.root, base=ws.diff_base())


@router.get("/repos/{repo_id}/change-cards")
def get_change_cards(ws: Ws) -> dict:
    """Every change vs the workspace's diff base as a card on the nearest existing block."""
    ws.sync()
    return build_change_cards(ws.engine, ws.root, base=ws.diff_base())


@router.post("/repos/{repo_id}/diff/{node_id:path}/accept")
def accept_diff(ws: WritableWs, node_id: str) -> dict:
    """Commits node_id's pending change to git, then reanalyzes and pings connected canvases."""
    ws.sync()
    # 404 / 409 / 500 by error type, from the table in bridge/errors.py.
    result = git_accept.accept_diff(ws.engine, ws.root, node_id)
    changed = ws.sync()
    ws.emit({"type": "changed", "paths": changed or [result.file_path]})
    return {"status": "committed", "file_path": result.file_path, "commit_sha": result.commit_sha}
