"""The one module in the bridge that can spend money: the startup diagram bootstrap.

🔴 This is the only path on which a `Workspace` can reach Anthropic (`patterns`; `c1`'s bootstrap is
now a pure table lookup, no credential needed). It used to be a method on `Workspace` itself, which
made a class that otherwise just reads files and runs git into one that could also bill an account —
and made "what can call Claude?" a question you answered by reading a 300-line class rather than a
30-line module.

The read-only guard travels with it: a pull-request workspace is a view, and a view must not
generate. Everything else about a diagram type (its prompt, its artifact path, what counts as
valid) lives in its `DiagramSpec`.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from codechroma.bridge.diagram_registry import DIAGRAMS
from codechroma.io import write_json

if TYPE_CHECKING:
    from codechroma.bridge.workspaces import Workspace

logger = logging.getLogger("uvicorn.error")


def bootstrap_if_missing(workspace: Workspace, kind: str) -> None:
    """Generates a diagram type's artifact if missing, via Claude only if a credential is needed."""
    spec = DIAGRAMS[kind]
    # A view may not generate, and a type with no bootstrap has nothing to generate from.
    if workspace.read_only or not spec.has_bootstrap:
        return
    path = workspace.diagram_path(kind)
    if path.exists():
        return
    # has_bootstrap=True (checked above) guarantees these are set, by construction.
    assert spec.bootstrap_context is not None
    assert spec.generate is not None
    # A type with no provider_from_env needs no credential; one that has it and gets None does.
    if spec.provider_from_env is None:
        provider = None
    else:
        provider = spec.provider_from_env()
        if provider is None:
            return
    try:
        payload = spec.bootstrap_context(workspace)
        diagram = spec.generate(payload, provider)
        if diagram is None:
            return
        write_json(path, diagram)
        logger.info("%s: bootstrap-generated %s", kind, path)
    except Exception:
        # A failed bootstrap must never fail the analyze that triggered it.
        logger.exception("%s: bootstrap generation failed", kind)


def bootstrap_all_if_missing(workspace: Workspace) -> None:
    """Every diagram type's bootstrap, run once as a workspace finishes coming up."""
    for kind in DIAGRAMS:
        bootstrap_if_missing(workspace, kind)
