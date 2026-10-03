"""Generic registration for the one skill-run route every composite kind serves identically.

Every composite skill-run kind (epic-brief) has an *output* route that is byte-identical
-- `{"lines": agent.get_output(key)}` -- differing only in the route path and how its job key (and
agent) resolve from the path params. That one route is written here once. (The custom-diagram,
diagram-type and research composite kinds this once also covered are all retired -- see
`skill_spec.py`'s own docstring.)

The generators/start/status/`-path`/cancel/save routes are deliberately NOT here. Each kind's start
carries bespoke prompt building (digest / bundle) and its cancel returns a distinct response shape
(epic adds `brief`) with distinct websocket extras (`job_key,item_id`). Folding those into a shared
registrar would force an awkward hook list more complex than the routes it replaced -- so they stay
hand-written beside each kind's own logic (the seam the planning doc calls out).
"""

from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter, Request

from codechroma.bridge.deps import Services

# Resolves the job key from the route's path params, e.g. `lambda p, s: p["type_id"]` for custom.
KeyResolver = Callable[[dict[str, str], Services], str]
# Optional id-guard, e.g. `_require_valid_id`; raises HTTPException on a malformed id.
Guard = Callable[[dict[str, str]], None]


def register_output_route(
    router: APIRouter,
    *,
    agent: str,
    key: KeyResolver,
    output_path: str,
    guard: Guard | None = None,
) -> None:
    """Registers a kind's `GET {output_path}` route serving `{"lines": ...}` from its job key."""

    @router.get(output_path)
    def get_skill_output(request: Request, services: Services) -> dict:
        """The skill run's progress lines so far, so a panel opened mid-run isn't blank."""
        params = request.path_params
        if guard is not None:
            guard(params)
        job_key = key(params, services)
        return {"lines": services.skill_agents[agent].get_output(job_key)}
