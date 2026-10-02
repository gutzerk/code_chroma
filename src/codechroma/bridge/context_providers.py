"""Named `ContextProvider`s -- each diagram type's own `generation_data` payload, by name.

Wraps today's `patterns_context.py`/`impact_context.py` bodies behind one `Protocol` so the
unified `GET /repos/{id}/{kind}/context` route (`routes/diagrams.py`) can dispatch by the type's
own `DiagramTypeDefinition.context` name instead of an `if kind == ...` branch. `c1` and `custom`
have no algorithmic content payload today (`context: None`) -- their envelope's `generation_data`
stays `null`; only `coverage`/`staleness` (shared add-ons, gated by `addons`) apply to them.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from codechroma.bridge.impact_context import build_impact_context
from codechroma.bridge.patterns_context import build_patterns_context

if TYPE_CHECKING:
    from codechroma.bridge.workspaces import Workspace

__all__ = ["ContextProvider", "CONTEXT_PROVIDERS", "register_context_provider"]


class ContextProvider(Protocol):
    def fetch(self, ws: Workspace, *, source: str = "diff", feature: str | None = None) -> dict: ...


class _PatternsContextProvider:
    """Verbatim what `GET /repos/{id}/patterns-context` returns today -- ignores source/feature."""

    def fetch(self, ws: Workspace, *, source: str = "diff", feature: str | None = None) -> dict:
        ws.sync()
        return build_patterns_context(ws.engine, ws.engine.snapshot())


class _ImpactContextProvider:
    """Verbatim what `GET /repos/{id}/impact-context` returns today (diff sponsor, hop 1)."""

    def fetch(self, ws: Workspace, *, source: str = "diff", feature: str | None = None) -> dict:
        return build_impact_context(ws, source, feature)


CONTEXT_PROVIDERS: dict[str, ContextProvider] = {
    "patterns": _PatternsContextProvider(),
    "impact": _ImpactContextProvider(),
}


def register_context_provider(name: str, provider: ContextProvider) -> None:
    CONTEXT_PROVIDERS[name] = provider
