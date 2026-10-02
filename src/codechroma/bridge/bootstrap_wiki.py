"""Bootstraps `.codechroma/wiki/` once, the first time a workspace comes up.

Unlike `bootstrap_diagrams.py`, this never reaches Anthropic — `generate_wiki()` is a pure,
offline read of the already-parsed `Graph` (FR-006). That's why it lives in its own module rather
than next to the money-spending diagram bootstraps: "what can call Claude?" stays answerable by
reading `bootstrap_diagrams.py` alone.

⚠ `GraphEngine` is not documented thread-safe for two calls in flight on the same instance. This
is safe today only because `bootstrap_wiki_if_missing` is called exactly once, from inside
`Workspace.analyze()`, which `WorkspaceRegistry.get()`/`_bring_up` single-flight per workspace id
and which always completes before that workspace's watchers start (so no `reanalyze()` can race
it). Do not call this from a request handler, a watcher callback, or anywhere else that could run
concurrently with `analyze()` on the same workspace.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from codechroma.bridge.workspaces import Workspace

logger = logging.getLogger("uvicorn.error")


def bootstrap_wiki_if_missing(workspace: Workspace) -> None:
    """Generates the wiki on first bring-up, never on a read-only view; call only from analyze()."""
    if workspace.read_only or workspace.wiki_index_path.exists():
        return
    try:
        workspace.engine.generate_wiki()
        logger.info("wiki: bootstrap-generated %s", workspace.wiki_index_path)
    except Exception:
        # A failed bootstrap must never fail the analyze that triggered it.
        logger.exception("wiki: bootstrap generation failed")
